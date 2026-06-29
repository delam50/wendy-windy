import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { formatClinicKnowledge } from "@/data/knowledge";
import {
  archiveWendyMessage,
  getConversationMessages,
  getRecentWendyConversationSummaries,
  WENDY_CONVERSATION_RETENTION_DAYS,
} from "@/lib/conversationArchive";
import {
  formatProviderRankingContext,
  rankWendyProviders,
} from "@/lib/providers";
import {
  getConversationInsightSummary,
  getTopQuestionTopics,
  incrementQuestionTopicCount,
  isProductionRuntime,
  logConversationInsight,
} from "@/lib/conversationInsights";
import {
  getKnowledgeSourceDiagnostics,
  getProviderKnowledgeDiagnostics,
  getResourceRetrievalDiagnostics,
  retrieveKnowledge,
  retrieveResources,
} from "@/lib/retrieveKnowledge";
import { getSupabaseDiagnostics } from "@/lib/supabaseServer";
import { systemPrompt } from "@/lib/systemPrompt";
import {
  formatWendyDateTimePrompt,
  getWendyDateTimeContext,
  type WendyDateTimeContext,
} from "@/lib/dateTimeContext";

export const runtime = "nodejs";

const publicErrorMessage =
  "Sorry, Wendy is having trouble connecting right now. Please try again in a moment, or book directly here: https://windyridgechiropractic.janeapp.com/";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type SessionMemory = {
  concern?: string;
  preferredLocation?: "Bozeman" | "Big Sky";
  discussedPricing?: boolean;
  bookingInfoProvided?: boolean;
  bookingLinkClicked?: boolean;
  recommendedResourceUrls?: string[];
};

type ChatRequestBody = {
  messages?: ChatMessage[];
  pageContext?: string;
  pageTitle?: string;
  pageUrl?: string;
  sessionId?: string;
  sessionMemory?: SessionMemory;
};

type IntentCategory =
  | "booking intent"
  | "educational intent"
  | "pricing intent"
  | "insurance intent"
  | "provider matching"
  | "urgent/red-flag symptoms"
  | "location intent"
  | "clinic hours intent"
  | "service intent"
  | "article/resource intent"
  | "aftercare intent"
  | "follow-up/contact intent";

const MAX_API_MESSAGES = 10;
const ADMIN_DIAGNOSTIC_TERMS = /\b(status|diagnostics?|usage|report|performance|health|system\s+report)\b/i;
const ADMIN_RETRIEVAL_DIAGNOSTIC_TERMS = /\b(retrieval matches|resource matches|why was no resource returned|why no resource|show retrieval|debug retrieval)\b/i;
const ADMIN_KNOWLEDGE_DIAGNOSTIC_TERMS =
  /\b(active knowledge sources|knowledge manifest|canonical for blogs|canonical blog|knowledge sources|knowledge index|provider knowledge|provider availability|dr\.?\s*claire availability|stale dr\.?\s*michelle references|who is in big sky today)\b/i;
const ADMIN_CONVERSATION_REVIEW_TERMS =
  /\b(show|review|summarize|list|recent|open|details?|messages?)\b.*\b(wendy|conversations?|chats?|dry needling|leads?|resources?|recent-\d+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{6,})\b|\b(conversations?|chats?)\s+(about|that became|where|for)\b/i;

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Record<string, unknown>;

  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0
  );
}

function getMessages(body: ChatRequestBody): ChatMessage[] {
  if (!Array.isArray(body.messages)) {
    return [];
  }

  return body.messages.filter(isChatMessage).slice(-MAX_API_MESSAGES);
}

function sanitizeContextValue(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function getPageContext(body: ChatRequestBody) {
  const pageTitle = sanitizeContextValue(body.pageTitle, 180);
  const pageUrl = sanitizeContextValue(body.pageUrl, 500);
  const legacyPageContext = sanitizeContextValue(body.pageContext, 1200);
  const pageDetails = [
    pageTitle ? `Page title: ${pageTitle}` : "",
    pageUrl ? `Page URL: ${pageUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [legacyPageContext, pageDetails].filter(Boolean).join("\n").slice(0, 1200);
}

function getRetrievalQuery(messages: ChatMessage[]) {
  const latestUserMessage = messages.findLast((message) => message.role === "user");
  const recentContext = messages
    .slice(-4)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [latestUserMessage?.content ?? "", recentContext].filter(Boolean).join("\n");
}

function userWantsMoreResources(messages: ChatMessage[]) {
  const latestUserMessage = messages.findLast((message) => message.role === "user");

  if (!latestUserMessage) {
    return false;
  }

  return /\b(more|additional|another|other)\s+(blogs?|resources?|articles?|reading)\b|\b(additional reading|more reading|read more)\b/i.test(
    latestUserMessage.content,
  );
}

function userHasResourceIntent(messages: ChatMessage[]) {
  const latestUserMessage = getLatestUserContent(messages);

  return /\b(blogs?|articles?|resources?|posts?|more reading|additional reading|send me a link|send a link|link|more info|anything on this|read more|reading)\b|\b(do you have|any|show me|do you cover)\b.*\b(blogs?|articles?|resources?|posts?)\b/i.test(
    latestUserMessage,
  );
}

function userHasFollowUpContactIntent(messages: ChatMessage[]) {
  return /\b(have (?:the )?team follow up|can someone contact me|can the clinic call me|someone (?:to )?reach out|want someone to reach out|front desk contact me|help scheduling|want to book but need help|someone follow up with me|contact me|call me|reach out|follow up with me)\b/i.test(
    getLatestUserContent(messages),
  );
}

function getLatestUserContent(messages: ChatMessage[]) {
  return messages.findLast((message) => message.role === "user")?.content ?? "";
}

function isAdminDiagnosticsRequest(messages: ChatMessage[]) {
  return (
    ADMIN_DIAGNOSTIC_TERMS.test(getLatestUserContent(messages)) ||
    ADMIN_RETRIEVAL_DIAGNOSTIC_TERMS.test(getLatestUserContent(messages)) ||
    ADMIN_KNOWLEDGE_DIAGNOSTIC_TERMS.test(getLatestUserContent(messages))
  );
}

function isAdminConversationReviewRequest(messages: ChatMessage[]) {
  return ADMIN_CONVERSATION_REVIEW_TERMS.test(getLatestUserContent(messages));
}

function hasValidAdminCode(messages: ChatMessage[]) {
  const adminCode = process.env.WENDY_ADMIN_CODE?.trim();
  const latestUserMessage = getLatestUserContent(messages).trim();

  return Boolean(adminCode && latestUserMessage.includes(adminCode));
}

function getAdminDiagnosticsFlags(messages: ChatMessage[]) {
  const adminEnvExists = Boolean(process.env.WENDY_ADMIN_CODE?.trim());
  const adminCodeDetected = hasValidAdminCode(messages);
  const adminIntentDetected = isAdminDiagnosticsRequest(messages);
  const adminReviewDetected = isAdminConversationReviewRequest(messages);

  return {
    adminEnvExists,
    adminCodeDetected,
    adminIntentDetected,
    adminReviewDetected,
    diagnosticsModeActivated: adminCodeDetected && adminIntentDetected,
    conversationReviewModeActivated: adminCodeDetected && adminReviewDetected,
  };
}

function isAdminRetrievalDiagnosticsRequest(messages: ChatMessage[]) {
  return ADMIN_RETRIEVAL_DIAGNOSTIC_TERMS.test(getLatestUserContent(messages));
}

function isAdminKnowledgeDiagnosticsRequest(messages: ChatMessage[]) {
  return ADMIN_KNOWLEDGE_DIAGNOSTIC_TERMS.test(getLatestUserContent(messages));
}

function getRetrievalDiagnosticQuery(messages: ChatMessage[]) {
  const latest = getLatestUserContent(messages);
  const forMatch = latest.match(/\b(?:for|about|on)\s+(.+)$/i);

  if (forMatch?.[1]) {
    return forMatch[1]
      .replace(/\b(manager code|show retrieval matches|why was no resource returned|why no resource|debug retrieval)\b/gi, "")
      .trim();
  }

  return latest
    .replace(/\b(manager code|show retrieval matches|why was no resource returned|why no resource|debug retrieval)\b/gi, "")
    .trim();
}

function includesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectIntentCategories(
  messages: ChatMessage[],
  pageContext: string,
): IntentCategory[] {
  const latestUserMessage = getLatestUserContent(messages);
  const combinedContext = `${latestUserMessage}\n${pageContext}`.toLowerCase();
  const intents = new Set<IntentCategory>();

  if (
    includesAny(combinedContext, [
      /\b(book|booking|schedule|appointment|availability|available|openings?|come in|be seen|new patient)\b/,
      /\bcan i get in|how soon|sign me up|ready to book\b/,
    ])
  ) {
    intents.add("booking intent");
  }

  if (
    includesAny(combinedContext, [
      /\b(hours?|open|closed|closing|today|tomorrow|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
      /\b(when is|when are|what time|clinic hours|office hours|business hours)\b/,
    ])
  ) {
    intents.add("clinic hours intent");
  }

  if (
    includesAny(combinedContext, [
      /\b(learn|explain|what is|what does|how does|why|article|resource|blog|read|details|information|info)\b/,
      /\b(can chiropractic help|is chiropractic|what should i expect)\b/,
    ])
  ) {
    intents.add("educational intent");
  }

  if (userHasResourceIntent(messages)) {
    intents.add("article/resource intent");
  }

  if (
    includesAny(combinedContext, [
      /\b(aftercare|what to expect|soreness|normal after|recovery|side effects|after treatment|after dry needling)\b/,
    ])
  ) {
    intents.add("aftercare intent");
  }

  if (
    includesAny(combinedContext, [
      /\b(price|pricing|cost|cash|rate|rates|fee|fees|how much|\$)\b/,
      /\b(new patient exam|follow-up|follow up|soft tissue|dry needling|adjustment \+ soft tissue|adjustment and soft tissue)\b/,
    ])
  ) {
    intents.add("pricing intent");
  }

  if (includesAny(combinedContext, [/\b(insurance|insured|coverage|covered|copay|deductible|benefits)\b/])) {
    intents.add("insurance intent");
  }

  if (
    includesAny(combinedContext, [
      /\b(service|services|adjustment|dry needling|soft tissue|massage|cupping|animal chiropractic|small animal|first visit|new patient exam|follow-up|follow up)\b/,
    ])
  ) {
    intents.add("service intent");
  }

  if (userHasFollowUpContactIntent(messages)) {
    intents.add("follow-up/contact intent");
  }

  if (
    includesAny(combinedContext, [
      /\b(provider|doctor|dr\.?|chiropractor|therapist|massage|who should|which doctor|which provider|who do i book)\b/,
      /\b(kyle|dave|david|josh|joshua|claire|nichole|james)\b/,
      /\b(pregnan|postpartum|newborn|baby|pediatric|ski|skiing|athlete|performance|rehab|four corners|big sky massage|bozeman massage)\b/,
      /\b(pet|pets|dog|dogs|cat|cats|animal|animals|small animal|veterinary|animal adjustment|animal adjustments|chiropractic for pets)\b/,
    ])
  ) {
    intents.add("provider matching");
  }

  if (
    includesAny(combinedContext, [
      /\b(urgent|emergency|er|severe|unbearable|worst pain|rapidly worsening|major trauma|car accident|fall|fever)\b/,
      /\b(chest pain|trouble breathing|shortness of breath|sudden weakness|numbness in groin|saddle anesthesia)\b/,
      /\b(loss of bowel|loss of bladder|can't control bowel|can't control bladder|stroke|fainting)\b/,
    ])
  ) {
    intents.add("urgent/red-flag symptoms");
  }

  if (
    includesAny(combinedContext, [
      /\b(location|where|bozeman|big sky|four corners|belgrade|which clinic|which office)\b/,
    ])
  ) {
    intents.add("location intent");
  }

  if (intents.size === 0) {
    intents.add("educational intent");
  }

  return Array.from(intents);
}

function detectTopicCategory(messages: ChatMessage[], pageContext: string) {
  const text = `${getLatestUserContent(messages)}\n${pageContext}`.toLowerCase();

  if (/\b(pet|pets|dog|dogs|cat|cats|animal|animals|small animal|veterinary)\b/.test(text)) {
    return "small animal chiropractic";
  }

  if (/\b(pregnan|postpartum|newborn|baby|pediatric|child|kids|family)\b/.test(text)) {
    return "pregnancy pediatric family care";
  }

  if (/\b(price|pricing|cost|cash|rate|rates|fee|fees|\$|new patient exam|follow-up|follow up|soft tissue|dry needling|adjustment \+ soft tissue|adjustment and soft tissue)\b/.test(text)) {
    return "pricing";
  }

  if (/\b(hours?|open|closed|closing|today|tomorrow|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|schedule|availability|available)\b/.test(text)) {
    return "clinic hours";
  }

  if (/\b(insurance|coverage|copay|deductible|benefits)\b/.test(text)) {
    return "insurance";
  }

  if (/\b(first visit|new patient|what to expect|nervous)\b/.test(text)) {
    return "first visit";
  }

  if (/\b(massage|massage therapy|bodywork)\b/.test(text)) {
    return "massage therapy";
  }

  if (/\b(neck pain|headache|headaches|migraine|migraines)\b/.test(text)) {
    return "neck pain headaches migraines";
  }

  if (/\b(low back|lower back|back pain|sciatica|disc)\b/.test(text)) {
    return "back pain";
  }

  if (/\b(ski|skiing|hiking|athlete|performance|training|outdoor|active)\b/.test(text)) {
    return "active lifestyle performance";
  }

  if (/\b(bozeman|big sky|four corners|location|where)\b/.test(text)) {
    return "locations";
  }

  if (/\b(book|booking|schedule|appointment|availability)\b/.test(text)) {
    return "booking";
  }

  return "general clinic question";
}

function getProviderRoutingGuidance(messages: ChatMessage[], pageContext: string) {
  const text = `${getLatestUserContent(messages)}\n${pageContext}`.toLowerCase();
  const guidance: string[] = [];

  if (/\b(pet|pets|dog|dogs|cat|cats|animal|animals|small animal|veterinary|animal adjustment|animal adjustments|chiropractic for pets)\b/.test(text)) {
    guidance.push(
      "Pet, dog, animal, small animal, veterinary chiropractic, or animal adjustment questions: Windy Ridge offers small animal chiropractic care in clinic with Dr. Josh at the Bozeman Four Corners location. Do not diagnose animal conditions or promise outcomes. Encourage checking JaneApp or contacting the clinic for availability, and advise consulting a veterinarian for urgent, worsening, or concerning symptoms.",
    );
  }

  if (/\b(pregnan|postpartum|newborn|baby|infant|pediatric|child|kids|mom|moms)\b/.test(text)) {
    if (/\bbig sky\b/.test(text)) {
      guidance.push(
        "Pregnancy, postpartum, perinatal, newborn, pediatric, child, baby, or family care in Big Sky: Dr. Claire is the primary provider to mention. Wednesdays are her Big Sky day. Do not say this care is unavailable in Big Sky; direct users to JaneApp or the clinic to confirm live openings.",
      );
    } else if (/\b(four corners|bozeman|belgrade|gallatin)\b/.test(text)) {
      guidance.push(
        "Pregnancy, postpartum, perinatal, newborn, pediatric, child, baby, or family care at Four Corners: Dr. Claire is the primary provider to mention, but she is not at Four Corners on Wednesdays because that is her Big Sky day. She also offers at-home mom/newborn visits when applicable.",
      );
    } else {
      guidance.push(
        "Pregnancy, postpartum, perinatal, newborn, pediatric, child, baby, or family care: Dr. Claire is the primary provider to mention. She is based at Four Corners, works in Big Sky on Wednesdays instead of Four Corners, and offers at-home mom/newborn visits when applicable.",
      );
    }
  }

  if (/\b(active|outdoor|ski|skiing|hiking|athlete|performance|training|trail|runner|rehab|mobility|movement|sport)\b/.test(text)) {
    guidance.push(
      "Active, outdoor, sports, performance, skiing, hiking, lower limb, ankle mobility, rehab, or movement restoration goals: Dr. Kyle is a strong option; he practices at both locations, with Big Sky on Thursdays only.",
    );
  }

  if (
    /\b(massage|massage therapy|bodywork)\b/.test(text) &&
    /\b(big sky)\b/.test(text)
  ) {
    guidance.push("Massage therapy in Big Sky: route to Nichole. Keep this distinct from chiropractic soft tissue work or dry needling.");
  }

  if (
    /\b(massage|massage therapy|bodywork)\b/.test(text) &&
    /\b(bozeman|four corners|belgrade|gallatin)\b/.test(text)
  ) {
    guidance.push("Massage therapy at Bozeman Four Corners: route to James. Keep this distinct from chiropractic soft tissue work or dry needling.");
  }

  if (
    /\b(massage|massage therapy|soft tissue massage|massage therapist)\b/.test(text) &&
    !/\b(big sky|bozeman|four corners|belgrade|gallatin)\b/.test(text)
  ) {
    guidance.push(
      "General massage therapy questions: mention both therapists and ask location preference if needed. Nichole is Big Sky only; James is Bozeman Four Corners only. Do not confuse massage therapy with chiropractic soft tissue treatment or dry needling.",
    );
  }

  if (
    /\b(four corners|bozeman|belgrade|gallatin|general chiropractor|general care|adjustment|chiropractic care)\b/.test(text) &&
    !/\b(pregnan|postpartum|newborn|baby|pediatric|massage|ski|skiing|athlete|performance|rehab|pet|dog|cat|animal|veterinary)\b/.test(text)
  ) {
    guidance.push(
      "General Four Corners chiropractic care, including broad neck or back pain: conversationally mention Dr. David or Dr. Josh as strong general options. Do not default to Dr. Kyle unless the user mentions sports, performance, ankle/lower limb, mobility, skiing, hiking, dry needling, or soft tissue care.",
    );
  }

  guidance.push(
    "Provider language: avoid saying 'best option', 'best provider', 'your best choice', or 'definitely the provider to see.' Use softer language like 'a strong option,' 'a good fit,' 'well aligned,' 'most directly aligned,' or 'I'd start by checking availability with.'",
  );

  return guidance;
}

function inferSuggestedProvider(messages: ChatMessage[], pageContext: string) {
  const rankedProviders = rankWendyProviders({
    query: getRetrievalQuery(messages),
    pageContext,
    max: 3,
  });

  return rankedProviders.length > 0
    ? rankedProviders.map((provider) => provider.name).join(" / ")
    : undefined;
}

function getPricingLocationGuidance(messages: ChatMessage[], pageContext: string) {
  const text = `${getLatestUserContent(messages)}\n${pageContext}`.toLowerCase();
  const mentionsFourCorners = /\b(four corners|bozeman|belgrade|gallatin)\b/.test(text);
  const mentionsBigSky = /\b(big sky)\b/.test(text);
  const mentionsNewPatient = /\b(new patient|new patient exam|first visit|exam|evaluation)\b/.test(text);
  const mentionsFollowUp = /\b(follow-up|follow up|return visit|return appointment)\b/.test(text);
  const mentionsSoftTissue = /\b(soft tissue|dry needling)\b/.test(text);
  const mentionsAdjustmentSoftTissue = /\b(adjustment \+ soft tissue|adjustment and soft tissue|adjustment with soft tissue)\b/.test(text);
  const asksGeneralVisitCost = /\b(how much|cost|price|pricing|rate|cash|visit|appointment)\b/.test(text);

  const guidance = [
    "Pricing intent: use explicit location-specific cash pricing when available. Four Corners / Bozeman cash rates: New Patient Exam $130 and Follow-Up Visit $65. Big Sky cash rates: New Patient Exam $150 and Follow-Up Visit $85. Never present one location's pricing as universal.",
    "Clarify that listed cash rates may vary based on service type and current JaneApp listings, and recommend confirming through JaneApp or the clinic.",
    "Insurance benefits vary by plan; final patient responsibility can depend on benefits, deductibles, copays, and services performed.",
  ];

  if (mentionsSoftTissue) {
    guidance.push(
      'Soft tissue or dry needling questions: Wendy may say, "Soft tissue visits are listed at $75 and include dry needling when clinically appropriate."',
    );
  }

  if (mentionsAdjustmentSoftTissue) {
    guidance.push(
      "Adjustment + Soft Tissue questions: do not guess a price. Say the current listed price is available on the Windy Ridge website or JaneApp.",
    );
  }

  if (!mentionsFourCorners && !mentionsBigSky && asksGeneralVisitCost) {
    guidance.push(
      "If the user asks a general visit-cost question without naming a location, briefly ask whether they mean Four Corners / Bozeman or Big Sky. You may give a cautious range if helpful: new patient exams are listed around $130 to $150 and follow-ups around $65 to $85 depending on location and service type.",
    );
  }

  if (mentionsFourCorners && !mentionsBigSky) {
    guidance.push(
      "Four Corners / Bozeman pricing context is relevant. Use Four Corners rates only for that location.",
    );
  }

  if (mentionsBigSky && !mentionsFourCorners) {
    guidance.push(
      "Big Sky pricing context is relevant. Use Big Sky rates only for that location.",
    );
  }

  if (mentionsNewPatient && !mentionsFollowUp) {
    guidance.push("The user likely means New Patient Exam pricing.");
  }

  if (mentionsFollowUp && !mentionsNewPatient) {
    guidance.push("The user likely means Follow-Up Visit pricing.");
  }

  return guidance.join(" ");
}

function getHoursGuidance(
  messages: ChatMessage[],
  pageContext: string,
  dateTime: WendyDateTimeContext,
) {
  const text = `${getLatestUserContent(messages)}\n${pageContext}`.toLowerCase();
  const mentionsFourCorners = /\b(four corners|bozeman|belgrade|gallatin|mill town)\b/.test(text);
  const mentionsBigSky = /\b(big sky|ousel falls)\b/.test(text);
  const asksOpenToday = /\b(open today|are you open|open right now|hours today|today's hours|today)\b/.test(text);
  const asksFridayBigSky = /\b(friday|fri)\b/.test(text) && mentionsBigSky;
  const asksKyleBigSky = /\b(kyle|dr\.?\s*kyle)\b/.test(text) && mentionsBigSky;
  const asksClaireWednesday = /\b(claire|dr\.?\s*claire)\b/.test(text) && /\b(wednesday|wed)\b/.test(text);
  const asksWhoBigSkyToday = /\bwho\b.*\b(big sky)\b.*\btoday\b|\bwho is in big sky today\b/.test(text);

  const guidance = [
    "Clinic hours intent: answer by location and distinguish clinic hours from live appointment openings or provider availability.",
    "Bozeman / Four Corners address: 43 Mill Town Loop, Bozeman, MT 59718. Hours: Monday 7:30 AM-5:00 PM, Tuesday 8:00 AM-5:00 PM, Wednesday 7:30 AM-5:00 PM, Thursday 8:00 AM-5:00 PM, Friday 8:00 AM-2:00 PM, Saturday closed, Sunday closed.",
    "Big Sky address: 116 Ousel Falls Road, Big Sky, MT 59716. General hours/provider schedule: Monday 12:00 PM-5:00 PM, Tuesday 8:00 AM-12:00 PM, Wednesday Dr. Claire is in Big Sky, Thursday Dr. Kyle is in Big Sky 8:00 AM-5:00 PM, Friday seasonal or at Dr. Dave's discretion, Saturday closed, Sunday closed.",
    `Today in the clinic timezone is ${dateTime.dayOfWeek}, ${dateTime.date}; the local time is ${dateTime.localTime} (${dateTime.timeOfDay}). Use that weekday for "today" questions.`,
    "Do not guarantee same-day appointment availability. For live openings, provider schedule changes, or booking details, direct users to JaneApp or the clinic.",
  ];

  if (asksOpenToday && !mentionsFourCorners && !mentionsBigSky) {
    guidance.push(
      "If the user asks whether Windy Ridge is open today and no location is clear, ask whether they mean Bozeman / Four Corners or Big Sky before giving one location's hours.",
    );
  }

  if (asksFridayBigSky) {
    guidance.push(
      "For Big Sky Friday availability, say it may be seasonal and at Dr. Dave's discretion, so users should confirm online or by calling.",
    );
  }

  if (asksKyleBigSky) {
    guidance.push("Dr. Kyle is in Big Sky Thursdays 8:00 AM-5:00 PM.");
  }

  if (asksClaireWednesday) {
    guidance.push("Wednesdays are Dr. Claire's Big Sky day; she is not at Four Corners on Wednesdays.");
  }

  if (asksWhoBigSkyToday && dateTime.dayOfWeek === "Wednesday") {
    guidance.push("Today is Wednesday, so Dr. Claire is the scheduled Big Sky chiropractor today. Do not imply a live opening; recommend checking JaneApp or calling.");
  } else if (asksWhoBigSkyToday && dateTime.dayOfWeek === "Thursday") {
    guidance.push("Today is Thursday, so Dr. Kyle is scheduled in Big Sky from 8:00 AM-5:00 PM. Do not imply a live opening; recommend checking JaneApp or calling.");
  } else if (asksWhoBigSkyToday && dateTime.dayOfWeek === "Friday") {
    guidance.push("Today is Friday. Big Sky availability may be seasonal or at Dr. Dave's discretion and should be checked online or by calling.");
  }

  return guidance.join(" ");
}

function getNextStepDecision(
  intents: IntentCategory[],
  sessionMemory: SessionMemory,
) {
  const urgent = intents.includes("urgent/red-flag symptoms");
  const explicitResourceRequest = intents.includes("article/resource intent");
  const followUpRequest = intents.includes("follow-up/contact intent");
  const bookingReady = intents.includes("booking intent") && !urgent;
  const pricingQuestion = intents.includes("pricing intent") && !urgent;
  const providerMatching = intents.includes("provider matching") && !urgent;
  const nervousNewPatient =
    intents.includes("aftercare intent") ||
    intents.includes("educational intent") && intents.includes("service intent");
  const shouldOfferBooking =
    (bookingReady || pricingQuestion) &&
    !sessionMemory.bookingInfoProvided &&
    !sessionMemory.bookingLinkClicked;
  const resourceLimit = urgent
    ? 0
    : explicitResourceRequest
      ? 4
      : providerMatching
        ? 0
      : nervousNewPatient || intents.includes("educational intent")
        ? 1
        : 0;

  return {
    urgent,
    explicitResourceRequest,
    followUpRequest,
    bookingReady,
    pricingQuestion,
    providerMatching,
    nervousNewPatient,
    shouldOfferBooking,
    resourceLimit,
    includeBookingResource: shouldOfferBooking,
    wantsMoreResources: explicitResourceRequest,
  };
}

function formatIntentGuidance(
  messages: ChatMessage[],
  pageContext: string,
  sessionMemory: SessionMemory,
  providerRankingContext: string,
  dateTime: WendyDateTimeContext,
) {
  const intents = detectIntentCategories(messages, pageContext);
  const providerGuidance = getProviderRoutingGuidance(messages, pageContext);
  const nextStepDecision = getNextStepDecision(intents, sessionMemory);
  const strategy: string[] = [];

  strategy.push(
    "Next-step priority framework: Safety > Direct answer > Relevant clinic-specific info > Resource card > Booking CTA > Lead form.",
  );

  if (intents.includes("urgent/red-flag symptoms")) {
    strategy.push(
      "Urgent/red-flag symptoms: be direct and brief. Tell the user to seek urgent or emergency medical care right away. Do not include booking CTAs, sales language, lead capture, or resource cards.",
    );
  }

  if (intents.includes("clinic hours intent")) {
    strategy.push(getHoursGuidance(messages, pageContext, dateTime));
  }

  if (intents.includes("booking intent")) {
    strategy.push(
      "Booking intent: give a direct JaneApp scheduling CTA unless a booking link was already provided recently.",
    );
  }

  if (intents.includes("educational intent")) {
    strategy.push(
      "Educational intent: answer first in plain language, then offer one highly relevant article/resource only when it genuinely helps.",
    );
  }

  if (intents.includes("article/resource intent")) {
    strategy.push(
      "Explicit resource intent: the user asked for blogs, articles, resources, more reading, or a link. Return 2 to 4 relevant resource cards when available, ordered by the best match first.",
    );
  }

  if (intents.includes("aftercare intent")) {
    strategy.push(
      "Aftercare intent: prioritize exact aftercare, what-to-expect, soreness, recovery, or side-effect resources over broad chiropractic pages.",
    );
  }

  if (intents.includes("pricing intent")) {
    strategy.push(getPricingLocationGuidance(messages, pageContext));
  }

  if (intents.includes("insurance intent")) {
    strategy.push(
      "Insurance intent: keep it practical and cautious; do not promise coverage. Suggest confirming benefits with insurance and current options with the clinic or JaneApp.",
    );
  }

  if (intents.includes("provider matching")) {
    strategy.push(
      "Provider matching: make provider recommendations conversational, not diagnostic. Mention one or two good-fit providers, not a long roster.",
    );
  }

  if (intents.includes("location intent")) {
    strategy.push(
      "Location intent: be specific about Bozeman Four Corners and Big Sky. Dr. Claire is in Big Sky Wednesdays and not at Four Corners that day; Dr. Kyle is in Big Sky Thursdays 8:00 AM-5:00 PM.",
    );
  }

  if (intents.includes("follow-up/contact intent")) {
    strategy.push(
      "Follow-up/contact intent: the UI should open the structured lead form. If answering in chat, direct the visitor to use the form rather than collecting details in free text.",
    );
  }

  if (!sessionMemory.bookingInfoProvided && !sessionMemory.bookingLinkClicked) {
    strategy.push(
      "CTA behavior: educational users get resources first; ready-to-book users get JaneApp; nervous or new users get a short first-visit explanation.",
    );
  } else {
    strategy.push(
      "CTA behavior: avoid repeating the same booking link unless the user clearly asks to book or needs the link again.",
    );
  }

  return [
    `Detected Wendy intent categories: ${intents.join(", ")}`,
    providerGuidance.length
      ? `Provider routing guidance:\n${providerGuidance.join("\n")}`
      : "",
    `Response strategy:\n${strategy.join("\n")}`,
    providerRankingContext,
    `Resource/CTA decision: resourceLimit=${nextStepDecision.resourceLimit}; bookingCTA=${nextStepDecision.shouldOfferBooking ? "yes" : "no"}; leadForm=${nextStepDecision.followUpRequest ? "yes" : "no"}; urgent=${nextStepDecision.urgent ? "yes" : "no"}.`,
    "Keep the answer concise, locally specific to Bozeman/Big Sky when relevant, and grounded in retrieved knowledge.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getSessionMemory(body: ChatRequestBody): SessionMemory {
  const memory = body.sessionMemory;

  if (!memory || typeof memory !== "object") {
    return {};
  }

  return {
    concern: sanitizeContextValue(memory.concern, 80) || undefined,
    preferredLocation:
      memory.preferredLocation === "Bozeman" || memory.preferredLocation === "Big Sky"
        ? memory.preferredLocation
        : undefined,
    discussedPricing: Boolean(memory.discussedPricing),
    bookingInfoProvided: Boolean(memory.bookingInfoProvided),
    bookingLinkClicked: Boolean(memory.bookingLinkClicked),
    recommendedResourceUrls: Array.isArray(memory.recommendedResourceUrls)
      ? memory.recommendedResourceUrls
          .filter((url) => typeof url === "string")
          .map((url) => sanitizeContextValue(url, 500))
          .filter(Boolean)
          .slice(-12)
      : [],
  };
}

function formatSessionMemory(memory: SessionMemory) {
  const memoryLines = [
    memory.concern ? `Previously mentioned general concern: ${memory.concern}` : "",
    memory.preferredLocation
      ? `Preferred location mentioned this session: ${memory.preferredLocation}`
      : "",
    memory.discussedPricing ? "Pricing or insurance has already been discussed." : "",
    memory.bookingInfoProvided
      ? "JaneApp booking information has already been provided this session."
      : "",
    memory.bookingLinkClicked
      ? "The visitor has already clicked a booking link this session."
      : "",
    memory.recommendedResourceUrls?.length
      ? `Resource URLs already recommended this session. Avoid repeating these unless the user asks for the same link again:\n${memory.recommendedResourceUrls.join("\n")}`
      : "",
  ].filter(Boolean);

  if (memoryLines.length === 0) {
    return "";
  }

  return `Session memory for this browser session only. Use it to avoid repeating yourself, but do not treat it as a medical record or long-term stored health history:\n${memoryLines.join("\n")}`;
}

function readGeneratedFile(fileName: string) {
  const filePath = path.join(process.cwd(), "data", "generated", fileName);

  if (!existsSync(filePath)) {
    return "";
  }

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function getBlogIndexDiagnostics() {
  const rawIndex = readGeneratedFile("blog-index.json");

  if (!rawIndex) {
    return {
      exists: false,
      articleCount: 0,
      categoryCount: 0,
      categories: [] as string[],
    };
  }

  try {
    const index = JSON.parse(rawIndex) as unknown;
    const articles = Array.isArray(index) ? index : [];
    const categories = Array.from(
      new Set(
        articles
          .map((article) =>
            article && typeof article === "object" && "category" in article
              ? String(article.category)
              : "",
          )
          .filter(Boolean),
      ),
    ).sort();

    return {
      exists: true,
      articleCount: articles.length,
      categoryCount: categories.length,
      categories,
    };
  } catch {
    return {
      exists: true,
      articleCount: 0,
      categoryCount: 0,
      categories: [] as string[],
    };
  }
}

function getConversationReviewFilters(messages: ChatMessage[]) {
  const latest = getLatestUserContent(messages).toLowerCase();
  const aboutMatch = latest.match(/\b(?:about|on)\s+([a-z0-9\s/-]{2,60})/i);
  const topic = aboutMatch?.[1]
    ?.replace(/\b(manager code|show|recent|wendy|conversations?|chats?)\b/gi, "")
    .trim();

  return {
    topic: topic || undefined,
    leadOnly: /\b(became leads?|lead submitted|submitted leads?|converted)\b/i.test(latest),
    resourcesOnly: /\b(recommended resources?|resources recommended|resource cards?|articles recommended)\b/i.test(latest),
  };
}

function getConversationDetailRequest(messages: ChatMessage[]) {
  const latest = getLatestUserContent(messages);
  const detailIntent =
    /\b(show|open|view|details?|messages?)\b.*\b(conversation|chat|messages?)\b/i.test(latest) ||
    /\b(conversation|chat)\s+(details?|messages?)\b/i.test(latest);

  if (!detailIntent) {
    return undefined;
  }

  const uuidMatch = latest.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  );

  if (uuidMatch) {
    return uuidMatch[0];
  }

  const shortMatch = latest.match(/\b(?:conversation\s+id|id|conversation|open conversation|show messages for conversation)\s*:?\s*([0-9a-f]{6,})\b/i);

  return shortMatch?.[1];
}

async function resolveConversationId(reference: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)) {
    return reference;
  }

  const recent = await getRecentWendyConversationSummaries({ limit: 12 });

  if (!recent.available) {
    return undefined;
  }

  return recent.conversations.find((conversation) =>
    conversation.id.toLowerCase().startsWith(reference.toLowerCase()),
  )?.id;
}

async function getAdminConversationDetailReport(messages: ChatMessage[]) {
  const requestedReference = getConversationDetailRequest(messages);

  if (!requestedReference) {
    return undefined;
  }

  const conversationId = await resolveConversationId(requestedReference);

  if (!conversationId) {
    return [
      "Wendy conversation details",
      "",
      `I could not find a recent conversation matching "${requestedReference}". Try copying the full Conversation ID from "Show recent Wendy conversations."`,
    ].join("\n");
  }

  const result = await getConversationMessages(conversationId);

  if (!result.available) {
    return [
      "Wendy conversation details",
      "",
      "Conversation archive is not available right now. Supabase may be unconfigured locally, or the archive tables may not exist yet.",
    ].join("\n");
  }

  if (!result.found || !result.conversation) {
    return [
      "Wendy conversation details",
      "",
      `I could not find conversation ${conversationId}.`,
    ].join("\n");
  }

  return [
    "Wendy conversation details",
    "",
    `Conversation ID: ${result.conversation.id}`,
    `Updated: ${new Date(result.conversation.updatedAt).toLocaleString("en-US", { timeZone: "America/Denver" })}`,
    `Topic: ${result.conversation.inferredTopic || "unknown"}`,
    `Intent: ${result.conversation.detectedIntent || "unknown"}`,
    `Page: ${result.conversation.pageTitle || result.conversation.pageUrl || "unknown"}`,
    `Lead submitted: ${result.conversation.leadSubmitted ? "yes" : "no"} | Resources: ${result.conversation.resourceCount} | Booking clicked: ${result.conversation.bookingClicked ? "yes" : "no"}`,
    "",
    result.messages.length
      ? result.messages
          .map((message) => {
            const label =
              message.role === "assistant"
                ? "Assistant"
                : message.role === "system"
                  ? "System"
                  : "User";

            return `${label}:\n${message.content}${message.redacted ? "\n[Redacted]" : ""}`;
          })
          .join("\n\n")
      : "No archived messages found for this conversation.",
    "",
    "Only stored redacted QA archive messages are shown. Hidden prompts, retrieval chunks, secrets, and API keys are not included.",
  ].join("\n");
}

async function getAdminConversationReviewReport(messages: ChatMessage[]) {
  const detailReport = await getAdminConversationDetailReport(messages);

  if (detailReport) {
    return detailReport;
  }

  const filters = getConversationReviewFilters(messages);
  const result = await getRecentWendyConversationSummaries({
    ...filters,
    limit: 8,
  });

  if (!result.available) {
    return [
      "Wendy conversation review",
      "",
      "Conversation archive is not available right now. Supabase may be unconfigured locally, or the archive tables may not exist yet.",
      "This does not affect Wendy's normal chat, lead capture, or analytics behavior.",
    ].join("\n");
  }

  if (result.conversations.length === 0) {
    return [
      "Wendy conversation review",
      "",
      "No matching recent conversations found.",
      `Archive retention target: ${WENDY_CONVERSATION_RETENTION_DAYS} days.`,
    ].join("\n");
  }

  return [
    "Wendy conversation review",
    "",
    `Showing up to ${result.conversations.length} recent short-term QA conversations.`,
    `Filters: ${[
      filters.topic ? `topic "${filters.topic}"` : "",
      filters.leadOnly ? "became leads" : "",
      filters.resourcesOnly ? "recommended resources" : "",
    ].filter(Boolean).join(", ") || "recent conversations"}`,
    "",
    ...result.conversations.map((conversation, index) =>
      [
        `${index + 1}. Ref: recent-${index + 1}`,
        `Conversation ID: ${conversation.id}`,
        `Short ID: ${conversation.id.slice(0, 8)}`,
        `Updated: ${new Date(conversation.updatedAt).toLocaleString("en-US", { timeZone: "America/Denver" })}`,
        `Topic: ${conversation.inferredTopic || "unknown"}`,
        `Intent: ${conversation.detectedIntent || "unknown"}`,
        `Page: ${conversation.pageTitle || conversation.pageUrl || "unknown"}`,
        `Lead submitted: ${conversation.leadSubmitted ? "yes" : "no"} | Resources: ${conversation.resourceCount} | Booking clicked: ${conversation.bookingClicked ? "yes" : "no"}`,
        conversation.suggestedProvider ? `Suggested provider: ${conversation.suggestedProvider}` : "",
        `Excerpt: ${conversation.excerpt}`,
      ].filter(Boolean).join("\n"),
    ),
    "",
    "These excerpts are redacted and intended for short-term QA review only, not medical records or lead-detail review.",
  ].join("\n\n");
}

async function getAdminDiagnosticsReport() {
  const blogIndex = getBlogIndexDiagnostics();
  const knowledgeDiagnostics = getKnowledgeSourceDiagnostics();
  const janeKnowledge = readGeneratedFile("jane-knowledge.md");
  const clinicIdentity = readGeneratedFile("clinic-identity.md");
  const insightSummary = await getConversationInsightSummary();
  const topQuestionTopics = await getTopQuestionTopics(5);
  const supabaseDiagnostics = await getSupabaseDiagnostics();
  const model = process.env.OPENAI_MODEL || "not configured";
  const leadEmailConfigured = Boolean(
    process.env.EMAIL_SERVER_HOST &&
      process.env.EMAIL_SERVER_PORT &&
      process.env.EMAIL_SERVER_USER &&
      process.env.EMAIL_SERVER_PASSWORD &&
      process.env.EMAIL_FROM &&
      process.env.LEAD_NOTIFICATION_EMAIL,
  );
  const recentIntentCounts = Object.entries(insightSummary.intentCounts)
    .sort((first, second) => second[1] - first[1])
    .slice(0, 5)
    .map(([intent, count]) => `${intent}: ${count}`)
    .join(", ") || "No local intent counts available";
  const recentTopicCounts = topQuestionTopics
    .map(({ topic, count }) => `${topic}: ${count}`)
    .join(", ") || "No local topic counts available";
  const funnelCounts = supabaseDiagnostics.funnelCounts;
  const topPagesByWidgetOpens = supabaseDiagnostics.topPagesByWidgetOpens
    .map((page) => `${page.pageTitle || page.pageUrl || "Unknown page"}: ${page.count}`)
    .join(", ") || "No widget-open page data available";
  const topClickedResources = supabaseDiagnostics.topClickedResources
    .map((resource) => `${resource.title || resource.url || "Unknown resource"}: ${resource.count}`)
    .join(", ") || "No resource click data available";
  const dateTime = getWendyDateTimeContext();

  return [
    "Wendy admin status report",
    "",
    `App status: Online`,
    `Current model: ${model}`,
    `Clinic date/time: ${dateTime.dayOfWeek}, ${dateTime.date} at ${dateTime.localTime} (${dateTime.timeOfDay}; ${dateTime.timeZone})`,
    `OpenAI API configured: ${process.env.OPENAI_API_KEY ? "Yes" : "No"}`,
    `Blog index exists: ${blogIndex.exists ? "Yes" : "No"}`,
    `Indexed blog resources: ${blogIndex.articleCount}`,
    `Knowledge manifest exists: ${knowledgeDiagnostics.manifestExists ? "Yes" : "No"}`,
    `Knowledge index chunks: ${knowledgeDiagnostics.knowledgeIndexChunkCount}`,
    `Canonical blog file: ${knowledgeDiagnostics.canonicalBlogFile}`,
    `Canonical clinic file: ${knowledgeDiagnostics.canonicalClinicFile}`,
    `Resource categories: ${blogIndex.categoryCount}`,
    blogIndex.categories.length
      ? `Category names: ${blogIndex.categories.join(", ")}`
      : "Category names: none available",
    `Jane/pricing knowledge exists: ${janeKnowledge ? "Yes" : "No"}`,
    `Clinic hours knowledge exists: ${
      /43 Mill Town Loop|116 Ousel Falls Road|Dr\. Kyle[\s\S]*8:00 AM-5:00 PM|Dr\. Claire[\s\S]*Wednesday/.test(clinicIdentity)
        ? "Yes"
        : "No"
    }`,
    `Provider routing knowledge exists: ${
      /dr\.?\s*(kyle|dave|josh|claire)|nichole|james/i.test(clinicIdentity)
        ? "Yes"
        : "No"
    }`,
    "Dr. Claire availability: Four Corners provider; Big Sky Wednesdays and not at Four Corners on Wednesdays; at-home mom/newborn visits when applicable.",
    `Dr. Michelle active references: ${knowledgeDiagnostics.staleProviderWarnings.length ? knowledgeDiagnostics.staleProviderWarnings.join(" ") : "none"}`,
    `Conversation-insights endpoint health: ${
      isProductionRuntime()
        ? "Healthy; production filesystem persistence is skipped safely"
        : "Healthy; local JSON persistence enabled"
    }`,
    `Conversation archive retention target: ${WENDY_CONVERSATION_RETENTION_DAYS} days`,
    `Supabase configured: ${supabaseDiagnostics.configured ? "Yes" : "No"}`,
    `Supabase health: ${supabaseDiagnostics.healthy ? "Healthy" : "Unavailable or not configured"}`,
    `Supabase total events: ${supabaseDiagnostics.totalEvents}`,
    `Supabase total leads: ${supabaseDiagnostics.totalLeads}`,
    `Funnel widget loads: ${funnelCounts.widget_loaded}`,
    `Funnel widget opens: ${funnelCounts.widget_opened}`,
    `Funnel messages sent: ${funnelCounts.message_sent}`,
    `Funnel assistant responses: ${funnelCounts.assistant_response_received}`,
    `Funnel resources recommended: ${funnelCounts.resource_recommended}`,
    `Funnel resource clicks: ${funnelCounts.resource_clicked}`,
    `Funnel booking clicks: ${funnelCounts.booking_link_clicked}`,
    `Funnel lead forms opened: ${funnelCounts.lead_form_opened}`,
    `Funnel leads submitted: ${funnelCounts.lead_submitted}`,
    `Top pages by widget opens: ${topPagesByWidgetOpens}`,
    supabaseDiagnostics.topTopics.length
      ? `Supabase top topics: ${supabaseDiagnostics.topTopics
          .map(({ topic, count }) => `${topic}: ${count}`)
          .join(", ")}`
      : "Supabase top topics: none available",
    `Top clicked resources: ${topClickedResources}`,
    supabaseDiagnostics.recentResourceClicks.length
      ? `Recent resource clicks: ${supabaseDiagnostics.recentResourceClicks
          .map((click) => String(click.resource_title || click.resource_url || "resource"))
          .join(", ")}`
      : "Recent resource clicks: none available",
    `Recent booking clicks: ${supabaseDiagnostics.recentBookingClicks.length}`,
    `Lead capture email configured: ${leadEmailConfigured ? "Yes" : "No"}`,
    `Recent safe analytics events: ${insightSummary.totalInsights}`,
    `Booking link click signals: ${insightSummary.bookingLinkClicks}`,
    `Lead form opened/submitted: ${insightSummary.leadFormOpened}/${insightSummary.leadFormSubmitted}`,
    `Resource recommendations logged: ${insightSummary.resourceRecommended}`,
    `Common intent categories: ${recentIntentCounts}`,
    `Recent top resource topics: ${recentTopicCounts}`,
    "",
    "No API keys, admin code, raw user messages, private lead details, or detailed health information are included in this report.",
  ].join("\n");
}

function getAdminRetrievalDiagnosticsReport(messages: ChatMessage[], pageContext: string) {
  const query = getRetrievalDiagnosticQuery(messages) || "dry needling";
  const diagnostics = getResourceRetrievalDiagnostics(
    {
      query,
      pageContext,
      conversationContext: "",
      excludedUrls: [],
      wantsMoreResources: true,
      includeBookingResource: false,
      retrievalMode: "explicit",
    },
    5,
  );

  return [
    "Wendy retrieval diagnostics",
    "",
    `Query: ${query}`,
    `Retrieval mode used: ${diagnostics.mode}`,
    `Fallback used: ${diagnostics.fallbackUsed ? "Yes" : "No"}`,
    "",
    diagnostics.returnedResources.length
      ? `Returned resources:\n${diagnostics.returnedResources
          .map(
            (resource, index) =>
              `${index + 1}. ${resource.title}\nScore: ${resource.score}\nType: ${resource.type}\nURL: ${resource.url}`,
          )
          .join("\n\n")}`
      : "Returned resources: none",
    "",
    diagnostics.topCandidates.length
      ? `Top candidates:\n${diagnostics.topCandidates
          .map(
            (candidate, index) =>
              `${index + 1}. ${candidate.title}\nScore: ${candidate.score}\nCategory: ${candidate.category}\nURL: ${candidate.url}\nWhy: ${candidate.reasons.join("; ") || "keyword/category fallback only"}`,
          )
          .join("\n\n")}`
      : "Top candidates: none",
    "",
    "Admin-only diagnostic output. No user messages, secrets, system prompts, or retrieval chunks are exposed.",
  ].join("\n");
}

function getProviderKnowledgeQuery(messages: ChatMessage[]) {
  const latest = getLatestUserContent(messages);
  const providerMatch = latest.match(/\b(dr\.?\s*(?:dave|david|josh|kyle|claire)|nichole|james)\b/i);

  return providerMatch?.[1] ?? "";
}

function getAdminKnowledgeDiagnosticsReport(messages: ChatMessage[]) {
  const latest = getLatestUserContent(messages);
  const providerQuery = getProviderKnowledgeQuery(messages);
  const dateTime = getWendyDateTimeContext();
  const diagnostics = getKnowledgeSourceDiagnostics();

  if (/\bstale dr\.?\s*michelle references\b/i.test(latest)) {
    return [
      "Wendy stale provider knowledge check",
      "",
      `Dr. Michelle active references: ${diagnostics.staleProviderWarnings.length ? diagnostics.staleProviderWarnings.join(" ") : "none"}`,
      `Current clinic date/time: ${dateTime.dayOfWeek}, ${dateTime.date} at ${dateTime.localTime} (${dateTime.timeOfDay})`,
      "Admin-only diagnostic output.",
    ].join("\n");
  }

  if (/\bwho is in big sky today\b/i.test(latest)) {
    const todayAnswer = dateTime.dayOfWeek === "Wednesday"
      ? "Dr. Claire is scheduled in Big Sky today; she is not at Four Corners on Wednesdays."
      : dateTime.dayOfWeek === "Thursday"
        ? "Dr. Kyle is scheduled in Big Sky today from 8:00 AM-5:00 PM."
        : dateTime.dayOfWeek === "Friday"
          ? "Friday Big Sky availability may be seasonal or at Dr. Dave's discretion."
          : "No named recurring Big Sky provider shift is documented for today beyond the general clinic schedule.";

    return [
      "Wendy Big Sky provider diagnostic",
      "",
      `Current clinic date/time: ${dateTime.dayOfWeek}, ${dateTime.date} at ${dateTime.localTime} (${dateTime.timeOfDay})`,
      todayAnswer,
      "Live appointment availability is not guaranteed; confirm in JaneApp or by calling the clinic.",
    ].join("\n");
  }

  if (/\b(provider knowledge|availability)\b/i.test(latest) && providerQuery) {
    const providerChunks = getProviderKnowledgeDiagnostics(providerQuery);

    return [
      "Wendy provider knowledge diagnostics",
      "",
      `Provider query: ${providerQuery}`,
      `Current clinic date/time: ${dateTime.dayOfWeek}, ${dateTime.date} at ${dateTime.localTime} (${dateTime.timeOfDay})`,
      providerChunks.length
        ? providerChunks
            .map((chunk, index) =>
              [
                `${index + 1}. ${chunk.title}`,
                `Source type: ${chunk.sourceType}`,
                `Chunk type: ${chunk.chunkType}`,
                `Priority: ${chunk.priority}`,
                `Canonical source: ${chunk.canonicalSource}`,
                `Tags: ${chunk.tags.join(", ") || "none"}`,
                `Text: ${chunk.text}`,
              ].join("\n"),
            )
            .join("\n\n")
        : "No provider chunk found for that provider query.",
      "",
      "Admin-only diagnostic output. No secrets, system prompts, API keys, or raw private lead details are included.",
    ].join("\n");
  }

  const activeSourceLines = diagnostics.activeSources.length
    ? diagnostics.activeSources
        .map(
          (source) =>
            `- ${source.source_id}: ${source.file_path} (${source.source_type}, priority ${source.priority}, canonical ${source.canonical ? "yes" : "no"}, exists ${source.exists ? "yes" : "no"})`,
        )
        .join("\n")
    : "No manifest active sources found; Wendy is using generated Markdown fallback.";
  const sourceTypeCounts = Object.entries(diagnostics.countsBySourceType)
    .map(([sourceType, count]) => `${sourceType}: ${count}`)
    .join(", ") || "none";
  const chunkTypeCounts = Object.entries(diagnostics.countsByChunkType)
    .map(([chunkType, count]) => `${chunkType}: ${count}`)
    .join(", ") || "none";

  return [
    "Wendy knowledge diagnostics",
    "",
    `Manifest exists: ${diagnostics.manifestExists ? "Yes" : "No"}`,
    `Architecture: ${diagnostics.architecture}`,
    `Manifest generated at: ${diagnostics.generatedAt ?? "unknown"}`,
    `Canonical blog file: ${diagnostics.canonicalBlogFile}`,
    `Canonical clinic file: ${diagnostics.canonicalClinicFile}`,
    `Blog index resources: ${diagnostics.blogIndexCount}`,
    `Knowledge index chunks: ${diagnostics.knowledgeIndexChunkCount}`,
    `Counts by source type: ${sourceTypeCounts}`,
    `Counts by chunk type: ${chunkTypeCounts}`,
    diagnostics.duplicateWarnings.length
      ? `Duplicate/stale warnings: ${diagnostics.duplicateWarnings.join(" ")}`
      : "Duplicate/stale warnings: none",
    `Dr. Michelle active references: ${diagnostics.staleProviderWarnings.length ? diagnostics.staleProviderWarnings.join(" ") : "none"}`,
    "Dr. Claire availability: Four Corners provider; Big Sky Wednesdays and not at Four Corners on Wednesdays; at-home mom/newborn visits when applicable.",
    `Current clinic date/time: ${dateTime.dayOfWeek}, ${dateTime.date} at ${dateTime.localTime} (${dateTime.timeOfDay}; ${dateTime.timeZone})`,
    "",
    "Active retrieval sources:",
    activeSourceLines,
    "",
    "Clinic facts, provider routing, pricing, hours, safety, booking, massage, and animal chiropractic are designed to outrank blog content. Blog/resource cards use data/generated/blog-index.json as canonical.",
  ].join("\n");
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const messages = getMessages(body);
  const pageContext = getPageContext(body);
  const sessionId = sanitizeContextValue(body.sessionId, 120);
  const pageTitle = sanitizeContextValue(body.pageTitle, 180);
  const pageUrl = sanitizeContextValue(body.pageUrl, 500);
  const dateTimeContext = getWendyDateTimeContext();

  if (messages.length === 0) {
    return Response.json(
      { error: "Please send Wendy a message to get started." },
      { status: 400 },
    );
  }

  const adminDiagnosticsFlags = getAdminDiagnosticsFlags(messages);

  if (process.env.NODE_ENV === "development") {
    console.log("[Wendy admin diagnostics]", adminDiagnosticsFlags);
  }

  if (
    adminDiagnosticsFlags.adminIntentDetected ||
    adminDiagnosticsFlags.adminReviewDetected
  ) {
    if (!adminDiagnosticsFlags.adminCodeDetected) {
      return Response.json({
        message:
          "I can help with general Windy Ridge website questions, but admin diagnostics and conversation review are only available to authorized managers.",
        resources: [],
      });
    }

    if (adminDiagnosticsFlags.conversationReviewModeActivated) {
      return Response.json({
        message: await getAdminConversationReviewReport(messages),
        resources: [],
      });
    }

    if (adminDiagnosticsFlags.diagnosticsModeActivated) {
      if (isAdminRetrievalDiagnosticsRequest(messages)) {
        return Response.json({
          message: getAdminRetrievalDiagnosticsReport(messages, pageContext),
          resources: [],
        });
      }

      if (isAdminKnowledgeDiagnosticsRequest(messages)) {
        return Response.json({
          message: getAdminKnowledgeDiagnosticsReport(messages),
          resources: [],
        });
      }

      return Response.json({
        message: await getAdminDiagnosticsReport(),
        resources: [],
      });
    }
  }

  if (adminDiagnosticsFlags.adminCodeDetected) {
    return Response.json({
      message:
        "I can help with Wendy diagnostics when you ask for a status report, or I can show recent Wendy conversations for QA review.",
      resources: [],
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!apiKey) {
    return Response.json({ error: publicErrorMessage }, { status: 500 });
  }

  if (!model) {
    return Response.json({ error: publicErrorMessage }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey });

  const sessionMemory = getSessionMemory(body);
  const sessionMemoryContext = formatSessionMemory(sessionMemory);
  const detectedIntents = detectIntentCategories(messages, pageContext);
  const topicCategory = detectTopicCategory(messages, pageContext);
  const rankedProviders = rankWendyProviders({
    query: getRetrievalQuery(messages),
    pageContext,
    max: 3,
  });
  const providerRankingContext = formatProviderRankingContext(rankedProviders);
  const suggestedProvider = rankedProviders.length > 0
    ? rankedProviders.map((provider) => provider.name).join(" / ")
    : inferSuggestedProvider(messages, pageContext);
  const nextStepDecision = getNextStepDecision(detectedIntents, sessionMemory);
  const intentGuidance = formatIntentGuidance(
    messages,
    pageContext,
    sessionMemory,
    providerRankingContext,
    dateTimeContext,
  );
  const hasResourceIntent = userHasResourceIntent(messages);
  const wantsMoreResources = userWantsMoreResources(messages);
  const resourceRetrievalMode = hasResourceIntent ? "explicit" : "contextual";
  const includeBookingResource = nextStepDecision.includeBookingResource;
  const retrievedKnowledge = retrieveKnowledge({
    query: [getRetrievalQuery(messages), intentGuidance].join("\n"),
    conversationContext: sessionMemoryContext,
    pageContext,
    excludedUrls: sessionMemory.recommendedResourceUrls ?? [],
    wantsMoreResources,
    includeBookingResource,
  });
  const resources = retrieveResources(
    {
      query: getRetrievalQuery(messages),
      conversationContext: sessionMemoryContext,
      pageContext,
      excludedUrls: sessionMemory.recommendedResourceUrls ?? [],
      wantsMoreResources: nextStepDecision.wantsMoreResources || wantsMoreResources,
      includeBookingResource,
      retrievalMode: resourceRetrievalMode,
    },
    nextStepDecision.resourceLimit,
  );

  if (process.env.NODE_ENV === "development") {
    console.log("[Wendy resource retrieval]", {
      resourceIntent: hasResourceIntent,
      wantsMoreResources,
      matchedResources: resources.map((resource) => ({
        title: resource.title,
        score: resource.score,
        type: resource.type,
      })),
      resourceCardsReturned: resources.length,
    });
  }
  const publicResources = resources.map((resource) => ({
    title: resource.title,
    summary: resource.summary,
    url: resource.url,
    type: resource.type,
  }));
  let conversationId: string | undefined;

  if (sessionId) {
    const userArchiveResult = await archiveWendyMessage({
      sessionId,
      pageTitle,
      pageUrl,
      inferredTopic: topicCategory,
      detectedIntent: detectedIntents.join(", "),
      preferredLocation: sessionMemory.preferredLocation,
      suggestedProvider,
      resourceCount: publicResources.length,
      bookingClicked: Boolean(sessionMemory.bookingLinkClicked),
      role: "user",
      content: getLatestUserContent(messages),
      metadata: {
        source: "api_chat",
        hasResourceIntent,
        wantsMoreResources,
      },
    });

    conversationId = userArchiveResult.conversationId;
  }

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: formatWendyDateTimePrompt(dateTimeContext) },
        { role: "system", content: formatClinicKnowledge() },
        {
          role: "system" as const,
          content: intentGuidance,
        },
        ...(sessionMemoryContext
          ? [
              {
                role: "system" as const,
                content: sessionMemoryContext,
              },
            ]
          : []),
        ...(retrievedKnowledge
          ? [
              {
                role: "system" as const,
                content: `Retrieved Windy Ridge website and JaneApp knowledge for this user message. Treat this as general website information, answer briefly, and offer source URLs naturally when useful. Resource cards are rendered separately by the app, so keep the answer conversational and do not force a bare list of links. For current booking, availability, appointment details, and pricing confirmation, recommend JaneApp because listed details can change:\n${retrievedKnowledge}`,
              },
            ]
          : []),
        ...(resources.length > 0
          ? [
              {
                role: "system" as const,
                content: `Dedicated recommendable resource cards selected for this user. Answer first, then briefly introduce these resources if relevant. The UI will render the cards separately, so do not duplicate every card URL in the prose unless it is essential:\n${resources
                  .map(
                    (resource, index) =>
                      `${index + 1}. ${resource.title}
Type: ${resource.type}
Summary: ${resource.summary}
URL: ${resource.url}`,
                  )
                  .join("\n\n")}`,
              },
            ]
          : []),
        ...(pageContext
          ? [
              {
                role: "system" as const,
                content: `Optional page context from the embedded WordPress page. Use this subtly only when it is clearly relevant to the user's question. It is okay to say things like "Looks like you're reading about neck pain" or mention Big Sky booking on a Big Sky page, but do not overdo it, sound creepy, or treat the page context as medical advice or verified clinic policy:\n${pageContext}`,
              },
            ]
          : []),
        ...messages,
      ] satisfies ChatCompletionMessageParam[],
    });

    const message = completion.choices[0]?.message.content;

    if (!message) {
      return Response.json({ error: publicErrorMessage }, { status: 502 });
    }

    try {
      if (sessionId) {
        const assistantArchiveResult = await archiveWendyMessage({
          sessionId,
          conversationId,
          pageTitle,
          pageUrl,
          inferredTopic: topicCategory,
          detectedIntent: detectedIntents.join(", "),
          preferredLocation: sessionMemory.preferredLocation,
          suggestedProvider,
          resourceCount: publicResources.length,
          bookingClicked: Boolean(sessionMemory.bookingLinkClicked),
          role: "assistant",
          content: message,
          metadata: {
            source: "api_chat",
            resourceTitles: publicResources.map((resource) => resource.title).slice(0, 4),
          },
        });
        conversationId = assistantArchiveResult.conversationId ?? conversationId;
      }

      await logConversationInsight({
        event: "chat_response",
        pageTitle,
        pageUrl,
        detectedIntent: detectedIntents,
        bookingLinkClicked: Boolean(sessionMemory.bookingLinkClicked),
        resourceRecommended:
          resources.length > 0 ||
          /https?:\/\/(?:www\.)?windyridgechiropractic\.com\/(?!.*janeapp)/i.test(
            message,
          ),
        topicCategory,
        metadata: {
          resourceTitle: resources[0]?.title,
          resourceUrl: resources[0]?.url,
          sessionId,
          conversationId,
          suggestedProvider,
          source: "api_chat",
        },
      });
      await incrementQuestionTopicCount(topicCategory);
    } catch (error) {
      console.error("Wendy conversation insight logging failed:", error);
    }

    return Response.json({ message, resources: publicResources });
  } catch (error) {
    console.error("OpenAI chat request failed:", error);
    return Response.json({ error: publicErrorMessage }, { status: 502 });
  }
}
