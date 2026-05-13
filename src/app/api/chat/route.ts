import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { formatClinicKnowledge } from "@/data/knowledge";
import {
  archiveWendyMessage,
  getRecentWendyConversationSummaries,
  WENDY_CONVERSATION_RETENTION_DAYS,
} from "@/lib/conversationArchive";
import {
  getConversationInsightSummary,
  getTopQuestionTopics,
  incrementQuestionTopicCount,
  isProductionRuntime,
  logConversationInsight,
} from "@/lib/conversationInsights";
import { retrieveKnowledge, retrieveResources } from "@/lib/retrieveKnowledge";
import { getSupabaseDiagnostics } from "@/lib/supabaseServer";
import { systemPrompt } from "@/lib/systemPrompt";

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
  | "location intent";

const MAX_API_MESSAGES = 10;
const ADMIN_DIAGNOSTIC_TERMS = /\b(status|diagnostics?|usage|report|performance|health|system\s+report)\b/i;
const ADMIN_CONVERSATION_REVIEW_TERMS =
  /\b(show|review|summarize|list|recent|conversations?|chats?)\b.*\b(wendy|conversations?|chats?|dry needling|leads?|resources?)\b|\b(conversations?|chats?)\s+(about|that became|where)\b/i;

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

  return /\b(blogs?|articles?|resources?|more reading|additional reading|send me a link|send a link|link|more info|anything on this|read more|reading)\b/i.test(
    latestUserMessage,
  );
}

function getLatestUserContent(messages: ChatMessage[]) {
  return messages.findLast((message) => message.role === "user")?.content ?? "";
}

function isAdminDiagnosticsRequest(messages: ChatMessage[]) {
  return ADMIN_DIAGNOSTIC_TERMS.test(getLatestUserContent(messages));
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
      /\b(learn|explain|what is|what does|how does|why|article|resource|blog|read|details|information|info)\b/,
      /\b(can chiropractic help|is chiropractic|what should i expect)\b/,
    ])
  ) {
    intents.add("educational intent");
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
      /\b(provider|doctor|dr\.?|chiropractor|therapist|massage|who should|which doctor|which provider|who do i book)\b/,
      /\b(kyle|dave|david|josh|joshua|claire|michelle|nichole|james)\b/,
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
    guidance.push(
      "Pregnancy, postpartum, newborn, pediatric, or family care: conversationally mention Dr. Claire at Four Corners; she also provides at-home visits for moms and newborns.",
    );
  }

  if (/\b(active|outdoor|ski|skiing|hiking|athlete|performance|training|trail|runner|rehab|mobility|movement|sport)\b/.test(text)) {
    guidance.push(
      "Active, outdoor, performance, skiing, hiking, rehab, or movement restoration goals: conversationally mention Dr. Kyle; he practices at both locations, with Big Sky on Thursdays only.",
    );
  }

  if (
    /\b(massage|massage therapy|bodywork)\b/.test(text) &&
    /\b(big sky)\b/.test(text)
  ) {
    guidance.push("Massage therapy in Big Sky: route to Nichole.");
  }

  if (
    /\b(massage|massage therapy|bodywork)\b/.test(text) &&
    /\b(bozeman|four corners|belgrade|gallatin)\b/.test(text)
  ) {
    guidance.push("Massage therapy at Bozeman Four Corners: route to James.");
  }

  if (
    /\b(four corners|bozeman|belgrade|gallatin|general chiropractor|general care|adjustment|chiropractic care)\b/.test(text) &&
    !/\b(pregnan|postpartum|newborn|baby|pediatric|massage|ski|skiing|athlete|performance|rehab|pet|dog|cat|animal|veterinary)\b/.test(text)
  ) {
    guidance.push(
      "General Four Corners chiropractic care: conversationally mention Dr. Josh or Dr. Dave. Dr. Dave is the senior provider and clinic owner; Dr. Josh practices at Four Corners only.",
    );
  }

  return guidance;
}

function inferSuggestedProvider(messages: ChatMessage[], pageContext: string) {
  const text = `${getLatestUserContent(messages)}\n${pageContext}`.toLowerCase();

  if (/\b(pet|pets|dog|dogs|cat|cats|animal|animals|small animal|veterinary)\b/.test(text)) {
    return "Dr. Josh";
  }

  if (/\b(pregnan|postpartum|newborn|baby|infant|pediatric|child|kids|mom|moms)\b/.test(text)) {
    return "Dr. Claire";
  }

  if (/\b(active|outdoor|ski|skiing|hiking|athlete|performance|training|rehab|mobility|movement|sport)\b/.test(text)) {
    return "Dr. Kyle";
  }

  if (/\b(massage|massage therapy|bodywork)\b/.test(text) && /\bbig sky\b/.test(text)) {
    return "Nichole";
  }

  if (/\b(massage|massage therapy|bodywork)\b/.test(text) && /\b(bozeman|four corners|belgrade|gallatin)\b/.test(text)) {
    return "James";
  }

  if (/\b(kyle|dave|josh|claire|michelle|nichole|james)\b/.test(text)) {
    const match = text.match(/\b(dr\.?\s*)?(kyle|dave|josh|claire|michelle|nichole|james)\b/);
    const name = match?.[2];

    if (!name) {
      return undefined;
    }

    if (name === "nichole" || name === "james") {
      return name[0].toUpperCase() + name.slice(1);
    }

    return `Dr. ${name[0].toUpperCase()}${name.slice(1)}`;
  }

  return undefined;
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

function formatIntentGuidance(
  messages: ChatMessage[],
  pageContext: string,
  sessionMemory: SessionMemory,
) {
  const intents = detectIntentCategories(messages, pageContext);
  const providerGuidance = getProviderRoutingGuidance(messages, pageContext);
  const strategy: string[] = [];

  if (intents.includes("urgent/red-flag symptoms")) {
    strategy.push(
      "Urgent/red-flag symptoms: be direct and brief. Tell the user to seek urgent or emergency medical care right away before discussing booking or resources.",
    );
  }

  if (intents.includes("booking intent")) {
    strategy.push(
      "Booking intent: give a direct JaneApp scheduling CTA unless a booking link was already provided recently.",
    );
  }

  if (intents.includes("educational intent")) {
    strategy.push(
      "Educational intent: answer first in plain language, then offer one highly relevant article/resource when retrieved knowledge provides one.",
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
      "Location intent: be specific about Bozeman Four Corners and Big Sky. Mention Big Sky Thursday availability for Dr. Kyle when relevant.",
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

async function getAdminConversationReviewReport(messages: ChatMessage[]) {
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
        `${index + 1}. ${new Date(conversation.updatedAt).toLocaleString("en-US", { timeZone: "America/Denver" })}`,
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

  return [
    "Wendy admin status report",
    "",
    `App status: Online`,
    `Current model: ${model}`,
    `OpenAI API configured: ${process.env.OPENAI_API_KEY ? "Yes" : "No"}`,
    `Blog index exists: ${blogIndex.exists ? "Yes" : "No"}`,
    `Indexed blog resources: ${blogIndex.articleCount}`,
    `Resource categories: ${blogIndex.categoryCount}`,
    blogIndex.categories.length
      ? `Category names: ${blogIndex.categories.join(", ")}`
      : "Category names: none available",
    `Jane/pricing knowledge exists: ${janeKnowledge ? "Yes" : "No"}`,
    `Provider routing knowledge exists: ${
      /dr\.?\s*(kyle|dave|josh|claire|michelle)|nichole|james/i.test(clinicIdentity)
        ? "Yes"
        : "No"
    }`,
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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const messages = getMessages(body);
  const pageContext = getPageContext(body);
  const sessionId = sanitizeContextValue(body.sessionId, 120);
  const pageTitle = sanitizeContextValue(body.pageTitle, 180);
  const pageUrl = sanitizeContextValue(body.pageUrl, 500);

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
  const suggestedProvider = inferSuggestedProvider(messages, pageContext);
  const intentGuidance = formatIntentGuidance(messages, pageContext, sessionMemory);
  const hasResourceIntent = userHasResourceIntent(messages);
  const wantsMoreResources = userWantsMoreResources(messages);
  const includeBookingResource = detectedIntents.includes("booking intent");
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
      query: [getRetrievalQuery(messages), intentGuidance].join("\n"),
      conversationContext: sessionMemoryContext,
      pageContext,
      excludedUrls: sessionMemory.recommendedResourceUrls ?? [],
      wantsMoreResources,
      includeBookingResource,
    },
    wantsMoreResources || hasResourceIntent ? 4 : 1,
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
