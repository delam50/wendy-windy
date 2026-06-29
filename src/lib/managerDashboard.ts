import { getWendyDateTimeContext } from "./dateTimeContext";
import { isMondayConfigured } from "./mondayServer";
import { rankWendyProviders, wendyProviders } from "./providers";
import {
  getKnowledgeSourceDiagnostics,
  getResourceRetrievalDiagnostics,
  retrieveDiagnosticDocuments,
} from "./retrieveKnowledge";
import { getSupabaseDiagnostics, getRecentWendyLeads } from "./supabaseServer";
import { getRecentWendyConversationSummaries } from "./conversationArchive";

export type ManagerRetrievalMode =
  | "explicit_resource_request"
  | "contextual_recommendation"
  | "provider_answer"
  | "pricing_answer"
  | "hours_answer";

function classifyQuery(query: string): {
  intent: string;
  mode: ManagerRetrievalMode;
} {
  const text = query.toLowerCase();

  if (/\b(price|pricing|cost|cash|rate|insurance|how much|\$)\b/.test(text)) {
    return { intent: "pricing intent", mode: "pricing_answer" };
  }

  if (/\b(hours?|open|closed|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|availability)\b/.test(text)) {
    return { intent: "clinic hours intent", mode: "hours_answer" };
  }

  if (/\bpregnan/.test(text) || /\b(provider|doctor|dr\.?|who should|which provider|claire|kyle|dave|david|josh|nichole|james|pediatric|newborn|massage)\b/.test(text)) {
    return { intent: "provider matching", mode: "provider_answer" };
  }

  if (/\b(contextual|recommendation|related reading)\b/.test(text)) {
    return { intent: "educational intent", mode: "contextual_recommendation" };
  }

  return { intent: "article/resource intent", mode: "explicit_resource_request" };
}

export async function getManagerOverview() {
  const [supabase, conversations, leads] = await Promise.all([
    getSupabaseDiagnostics(),
    getRecentWendyConversationSummaries({ limit: 12 }),
    getRecentWendyLeads(20),
  ]);
  const knowledge = getKnowledgeSourceDiagnostics();
  const time = getWendyDateTimeContext();
  const openAiConfigured = Boolean(
    process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL,
  );
  const mondayConfigured = isMondayConfigured();

  return {
    generatedAt: new Date().toISOString(),
    system: {
      app: { configured: true, healthy: true, label: "Online" },
      clinicTime: time,
      supabase: {
        configured: supabase.configured,
        healthy: supabase.healthy,
      },
      openai: {
        configured: openAiConfigured,
        healthy: openAiConfigured,
        note: openAiConfigured
          ? "Configuration present; no billable live model ping was performed."
          : "Server configuration is incomplete.",
      },
      monday: {
        configured: mondayConfigured,
        healthy: mondayConfigured,
        note: mondayConfigured
          ? "Configuration present; recent lead rows show push outcomes."
          : "Server configuration is incomplete.",
      },
      blogIndex: {
        configured: knowledge.blogIndexCount > 0,
        healthy: knowledge.blogIndexCount > 0,
        count: knowledge.blogIndexCount,
      },
      knowledgeManifest: {
        configured: knowledge.manifestExists,
        healthy: knowledge.manifestExists && knowledge.knowledgeIndexChunkCount > 0,
      },
      providerDirectory: {
        configured: wendyProviders.length > 0,
        healthy: wendyProviders.length > 0,
        count: wendyProviders.length,
      },
      recentFunctions: [
        { name: "Analytics aggregation", healthy: supabase.healthy },
        { name: "Conversation archive", healthy: conversations.available },
        { name: "Lead archive", healthy: leads.available },
        { name: "Knowledge retrieval", healthy: knowledge.knowledgeIndexChunkCount > 0 },
      ],
    },
    analytics: {
      funnel: supabase.funnelCounts,
      topTopics: supabase.topTopics,
      topPages: supabase.topPagesByWidgetOpens,
      topClickedResources: supabase.topClickedResources,
      leadCount: supabase.totalLeads,
      totalEvents: supabase.totalEvents,
    },
    conversations: {
      available: conversations.available,
      conversations: conversations.conversations.map((conversation) => {
        const safeConversation = { ...conversation };
        delete safeConversation.sessionId;
        return safeConversation;
      }),
    },
    knowledge: {
      manifestExists: knowledge.manifestExists,
      architecture: knowledge.architecture,
      generatedAt: knowledge.generatedAt,
      sources: knowledge.allSources,
      activeSources: knowledge.activeSources,
      canonicalBlogFile: knowledge.canonicalBlogFile,
      canonicalClinicFile: knowledge.canonicalClinicFile,
      blogIndexCount: knowledge.blogIndexCount,
      knowledgeIndexChunkCount: knowledge.knowledgeIndexChunkCount,
      providerCount: wendyProviders.length,
      pricingKnowledgeHealthy: (knowledge.countsBySourceType.pricing ?? 0) > 0,
      hoursKnowledgeHealthy: (knowledge.countsBySourceType.hours ?? 0) > 0,
      staleProviderReferenceCount: knowledge.staleProviderWarnings.length,
      staleProviderWarnings: knowledge.staleProviderWarnings,
      duplicateWarnings: knowledge.duplicateWarnings,
    },
    leads,
  };
}

export function inspectManagerRag(query: string) {
  const normalizedQuery = query.trim().slice(0, 500);
  const classification = classifyQuery(normalizedQuery);
  const resourceMode = classification.mode === "explicit_resource_request"
    ? "explicit"
    : "contextual";
  const knowledge = getKnowledgeSourceDiagnostics();
  const resourceDiagnostics = getResourceRetrievalDiagnostics(
    {
      query: normalizedQuery,
      pageContext: "",
      conversationContext: "",
      excludedUrls: [],
      wantsMoreResources: classification.mode === "explicit_resource_request",
      includeBookingResource: false,
      retrievalMode: resourceMode,
    },
    8,
  );
  const rankedMatches = retrieveDiagnosticDocuments(
    {
      query: normalizedQuery,
      pageContext: "",
      conversationContext: "",
      excludedUrls: [],
      wantsMoreResources: classification.mode === "explicit_resource_request",
      includeBookingResource: false,
      retrievalMode: resourceMode,
    },
    10,
  ).map((match, index) => ({
    ...match,
    status: index < 3 ? "accepted" : "rejected",
    reason: index < 3
      ? "Top-three ranked match selected for answer context."
      : "Ranked below the answer-context inspection limit.",
  }));

  return {
    query: normalizedQuery,
    detectedIntent: classification.intent,
    retrievalMode: classification.mode,
    sourcesSearched: knowledge.activeSources.map((source) => ({
      file: source.file_path,
      sourceType: source.source_type,
      canonical: Boolean(source.canonical),
    })),
    rankedMatches,
    resourceCandidates: resourceDiagnostics.topCandidates,
    fallbackUsed: resourceDiagnostics.fallbackUsed,
    fallbackMatches: resourceDiagnostics.fallbackMatches,
    finalResources: ["explicit_resource_request", "contextual_recommendation"].includes(
      classification.mode,
    )
      ? resourceDiagnostics.returnedResources
      : [],
  };
}

function detectProviderCategory(query: string) {
  const text = query.toLowerCase();
  if (/\bpregnan/.test(text) || /\b(postpartum|perinatal|pediatric|kids?|child|baby|newborn|family)\b/.test(text)) return "pregnancy / pediatric / family care";
  if (/\b(massage|massage therapist|bodywork)\b/.test(text)) return "massage therapy";
  if (/\b(pet|dog|cat|animal|veterinary)\b/.test(text)) return "small animal chiropractic";
  if (/\b(sport|ski|hike|athlete|performance|ankle|mobility|training)\b/.test(text)) return "sports / performance";
  if (/\b(neck|back|sciatica|headache|migraine)\b/.test(text)) return "general pain / chiropractic";
  return "general provider matching";
}

export function inspectManagerProviderRouting(query: string) {
  const normalizedQuery = query.trim().slice(0, 500);
  const text = normalizedQuery.toLowerCase();
  const location = /\bbig sky\b/.test(text)
    ? "Big Sky"
    : /\b(four corners|bozeman|belgrade|gallatin)\b/.test(text)
      ? "Four Corners"
      : "Not specified";
  const ranked = rankWendyProviders({ query: normalizedQuery, max: 6 });

  return {
    query: normalizedQuery,
    detectedLocation: location,
    detectedCategory: detectProviderCategory(normalizedQuery),
    rankedProviders: ranked.map((provider) => ({
      id: provider.id,
      name: provider.name,
      role: provider.role,
      locations: provider.locations,
      availability: provider.availabilityNote,
      focus: provider.focus,
      score: provider.score,
      reasons: provider.reasons,
    })),
    recommendationRules: [
      "Dr. Claire is primary for pregnancy, postpartum, perinatal, pediatric, newborn, and family care; Big Sky Wednesdays and not Four Corners Wednesdays.",
      "Dr. Kyle is in Big Sky Thursdays 8 AM-5 PM and aligns with sports/performance care.",
      "Dr. Dave practices at both locations with varying hours.",
      "Dr. Josh is Four Corners and provides small-animal chiropractic.",
      "Nichole provides Big Sky massage; James provides Four Corners massage.",
      "Never guarantee live appointment availability; confirm in JaneApp or with the clinic.",
    ],
  };
}
