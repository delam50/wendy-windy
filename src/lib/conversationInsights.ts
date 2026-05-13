import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  getSupabaseDiagnostics,
  incrementWendyTopicCount,
  writeWendyEvent,
} from "@/lib/supabaseServer";
import { updateWendyConversationFromInsight } from "@/lib/conversationArchive";

export type ConversationInsightEvent =
  | "chat_response"
  | "widget_loaded"
  | "widget_opened"
  | "widget_closed"
  | "message_sent"
  | "assistant_response_received"
  | "quick_action_clicked"
  | "resource_recommended"
  | "resource_clicked"
  | "resource_link_clicked"
  | "booking_link_clicked"
  | "lead_form_opened"
  | "lead_submitted"
  | "lead_form_submitted"
  | "error_shown";

export type ConversationInsight = {
  id: string;
  timestamp: string;
  event: ConversationInsightEvent;
  pageTitle?: string;
  pageUrl?: string;
  detectedIntent?: string[];
  bookingLinkClicked?: boolean;
  leadFormOpened?: boolean;
  leadFormSubmitted?: boolean;
  resourceRecommended?: boolean;
  topicCategory?: string;
  metadata?: {
    quickActionLabel?: string;
    leadLocationPreference?: string;
    source?: string;
    errorType?: string;
    resourceTitle?: string;
    resourceUrl?: string;
    sessionId?: string;
    conversationId?: string;
    suggestedProvider?: string;
  };
};

const insightsFilePath = path.join(
  process.cwd(),
  "data",
  "generated",
  "conversation-insights.json",
);
const topicCountsFilePath = path.join(
  process.cwd(),
  "data",
  "generated",
  "question-topic-counts.json",
);
const MAX_INSIGHTS = 1000;
const TOPIC_CATEGORIES = [
  "back pain",
  "neck pain",
  "headaches",
  "dry needling",
  "pricing",
  "insurance",
  "first visit",
  "Big Sky",
  "Bozeman",
  "pregnancy",
  "pediatric/newborn",
  "massage",
  "animal chiropractic",
  "provider matching",
] as const;

export type QuestionTopicCategory = (typeof TOPIC_CATEGORIES)[number];

export function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function sanitizeUrl(value: unknown) {
  const url = sanitizeText(value, 500);

  if (!url) {
    return "";
  }

  try {
    const parsedUrl = new URL(url);
    parsedUrl.hash = "";
    return parsedUrl.toString().slice(0, 500);
  } catch {
    return url;
  }
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sanitized = value
    .filter((item) => typeof item === "string")
    .map((item) => sanitizeText(item, 80))
    .filter(Boolean)
    .slice(0, 8);

  return sanitized.length > 0 ? sanitized : undefined;
}

function getSupabaseEventName(event: ConversationInsightEvent) {
  if (event === "resource_link_clicked") {
    return "resource_clicked";
  }

  if (event === "lead_form_submitted") {
    return "lead_submitted";
  }

  return event;
}

async function readExistingInsights() {
  try {
    const file = await readFile(insightsFilePath, "utf8");
    const parsed = JSON.parse(file) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readJsonArray(filePath: string) {
  try {
    const file = await readFile(filePath, "utf8");
    const parsed = JSON.parse(file) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readTopicCountsRecord() {
  try {
    const file = await readFile(topicCountsFilePath, "utf8");
    const parsed = JSON.parse(file) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([topic, count]) => TOPIC_CATEGORIES.includes(topic as QuestionTopicCategory) && typeof count === "number")
        .map(([topic, count]) => [topic, Math.max(0, Math.floor(count as number))]),
    ) as Partial<Record<QuestionTopicCategory, number>>;
  } catch {
    return {};
  }
}

export async function logConversationInsight(
  insight: Omit<ConversationInsight, "id" | "timestamp"> & {
    timestamp?: string;
  },
) {
  const safeInsight: ConversationInsight = {
    id: crypto.randomUUID(),
    timestamp: insight.timestamp ?? new Date().toISOString(),
    event: insight.event,
    pageTitle: sanitizeText(insight.pageTitle, 180) || undefined,
    pageUrl: sanitizeUrl(insight.pageUrl) || undefined,
    detectedIntent: sanitizeStringArray(insight.detectedIntent),
    bookingLinkClicked: Boolean(insight.bookingLinkClicked),
    leadFormOpened: Boolean(insight.leadFormOpened),
    leadFormSubmitted: Boolean(insight.leadFormSubmitted),
    resourceRecommended: Boolean(insight.resourceRecommended),
    topicCategory: sanitizeText(insight.topicCategory, 80) || undefined,
    metadata: {
      quickActionLabel: sanitizeText(insight.metadata?.quickActionLabel, 120) || undefined,
      leadLocationPreference:
        sanitizeText(insight.metadata?.leadLocationPreference, 40) || undefined,
      source: sanitizeText(insight.metadata?.source, 80) || undefined,
      errorType: sanitizeText(insight.metadata?.errorType, 80) || undefined,
      resourceTitle: sanitizeText(insight.metadata?.resourceTitle, 180) || undefined,
      resourceUrl: sanitizeUrl(insight.metadata?.resourceUrl) || undefined,
      sessionId: sanitizeText(insight.metadata?.sessionId, 120) || undefined,
      conversationId: sanitizeText(insight.metadata?.conversationId, 120) || undefined,
      suggestedProvider:
        sanitizeText(insight.metadata?.suggestedProvider, 120) || undefined,
    },
  };
  const supabaseResult = await writeWendyEvent({
    eventName: getSupabaseEventName(safeInsight.event),
    pageTitle: safeInsight.pageTitle,
    pageUrl: safeInsight.pageUrl,
    topicCategory: safeInsight.topicCategory,
    intent: safeInsight.detectedIntent?.join(", "),
    resourceTitle: safeInsight.metadata?.resourceTitle,
    resourceUrl: safeInsight.metadata?.resourceUrl,
    preferredLocation: safeInsight.metadata?.leadLocationPreference,
    suggestedProvider: safeInsight.metadata?.suggestedProvider,
    metadata: {
      bookingLinkClicked: safeInsight.bookingLinkClicked,
      leadFormOpened: safeInsight.leadFormOpened,
      leadFormSubmitted: safeInsight.leadFormSubmitted,
      resourceRecommended: safeInsight.resourceRecommended,
      quickActionLabel: safeInsight.metadata?.quickActionLabel,
      source: safeInsight.metadata?.source,
      errorType: safeInsight.metadata?.errorType,
      sessionId: safeInsight.metadata?.sessionId,
      conversationId: safeInsight.metadata?.conversationId,
    },
  });

  if (
    [
      "chat_response",
      "message_sent",
      "resource_recommended",
      "resource_clicked",
      "resource_link_clicked",
      "booking_link_clicked",
      "lead_form_opened",
      "lead_submitted",
      "lead_form_submitted",
    ].includes(safeInsight.event)
  ) {
    await updateWendyConversationFromInsight({
      sessionId: safeInsight.metadata?.sessionId,
      conversationId: safeInsight.metadata?.conversationId,
      pageTitle: safeInsight.pageTitle,
      pageUrl: safeInsight.pageUrl,
      inferredTopic: safeInsight.topicCategory,
      detectedIntent: safeInsight.detectedIntent?.join(", "),
      preferredLocation: safeInsight.metadata?.leadLocationPreference,
      suggestedProvider: safeInsight.metadata?.suggestedProvider,
      leadSubmitted: safeInsight.leadFormSubmitted,
      resourceCount: safeInsight.resourceRecommended ? 1 : undefined,
      bookingClicked: safeInsight.bookingLinkClicked,
      metadata: {
        event: getSupabaseEventName(safeInsight.event),
        resourceTitle: safeInsight.metadata?.resourceTitle,
        resourceUrl: safeInsight.metadata?.resourceUrl,
      },
    });
  }

  if (isProductionRuntime()) {
    return supabaseResult.persisted
      ? { persisted: true, destination: "supabase" }
      : { persisted: false, reason: "persistence_unavailable" };
  }

  const existingInsights = await readExistingInsights();
  existingInsights.push(safeInsight);

  try {
    await mkdir(path.dirname(insightsFilePath), { recursive: true });
    await writeFile(
      insightsFilePath,
      `${JSON.stringify(existingInsights.slice(-MAX_INSIGHTS), null, 2)}\n`,
    );
    return {
      persisted: true,
      destination: supabaseResult.persisted ? "supabase_and_local" : "local",
    };
  } catch {
    return { persisted: false, reason: "write_failed" };
  }
}

// Developer-only review helper:
// import { readConversationInsights } from "@/lib/conversationInsights";
// const insights = await readConversationInsights();
export async function readConversationInsights() {
  if (isProductionRuntime()) {
    return [];
  }

  return readExistingInsights() as Promise<ConversationInsight[]>;
}

export function normalizeQuestionTopicCategory(
  topic: string | undefined,
): QuestionTopicCategory | undefined {
  const normalized = (topic ?? "").toLowerCase();

  if (/dry needling|soft tissue/.test(normalized)) return "dry needling";
  if (/animal|pet|dog|cat/.test(normalized)) return "animal chiropractic";
  if (/pregnan|postpartum/.test(normalized)) return "pregnancy";
  if (/pediatric|newborn|baby|family/.test(normalized)) return "pediatric/newborn";
  if (/massage/.test(normalized)) return "massage";
  if (/provider|doctor|dr\.?|matching/.test(normalized)) return "provider matching";
  if (/insurance/.test(normalized)) return "insurance";
  if (/pricing|cost|cash|rate/.test(normalized)) return "pricing";
  if (/first visit|new patient/.test(normalized)) return "first visit";
  if (/big sky/.test(normalized)) return "Big Sky";
  if (/bozeman|four corners|location/.test(normalized)) return "Bozeman";
  if (/neck/.test(normalized)) return "neck pain";
  if (/headache|migraine/.test(normalized)) return "headaches";
  if (/back|sciatica|disc/.test(normalized)) return "back pain";

  return undefined;
}

export async function incrementQuestionTopicCount(topic: string | undefined) {
  const normalizedTopic = normalizeQuestionTopicCategory(topic);

  if (!normalizedTopic) {
    return { persisted: false, topic: normalizedTopic };
  }

  const supabaseResult = await incrementWendyTopicCount(normalizedTopic);

  if (isProductionRuntime()) {
    return supabaseResult.persisted
      ? { persisted: true, topic: normalizedTopic, destination: "supabase" }
      : { persisted: false, topic: normalizedTopic };
  }

  try {
    const counts = await readTopicCountsRecord();
    counts[normalizedTopic] = (counts[normalizedTopic] ?? 0) + 1;
    await mkdir(path.dirname(topicCountsFilePath), { recursive: true });
    await writeFile(topicCountsFilePath, `${JSON.stringify(counts, null, 2)}\n`);

    return {
      persisted: true,
      topic: normalizedTopic,
      destination: supabaseResult.persisted ? "supabase_and_local" : "local",
    };
  } catch {
    return { persisted: false, topic: normalizedTopic };
  }
}

export async function readQuestionTopicCounts() {
  if (isProductionRuntime()) {
    return {};
  }

  return readTopicCountsRecord();
}

export async function getTopQuestionTopics(limit = 4) {
  const supabaseDiagnostics = await getSupabaseDiagnostics();

  if (supabaseDiagnostics.configured && supabaseDiagnostics.topTopics.length > 0) {
    return supabaseDiagnostics.topTopics
      .slice(0, limit)
      .map(({ topic, count }) => ({ topic: topic as QuestionTopicCategory, count }));
  }

  const counts = await readQuestionTopicCounts();

  return Object.entries(counts)
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([topic, count]) => ({ topic: topic as QuestionTopicCategory, count }));
}

export async function getConversationInsightSummary() {
  if (isProductionRuntime()) {
    return {
      totalInsights: 0,
      eventCounts: {},
      intentCounts: {},
      topicCounts: {},
      bookingLinkClicks: 0,
      leadFormOpened: 0,
      leadFormSubmitted: 0,
      resourceRecommended: 0,
    };
  }

  const insights = await readJsonArray(insightsFilePath) as ConversationInsight[];
  const eventCounts: Record<string, number> = {};
  const intentCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};
  let bookingLinkClicks = 0;
  let leadFormOpened = 0;
  let leadFormSubmitted = 0;
  let resourceRecommended = 0;

  for (const insight of insights.slice(-250)) {
    eventCounts[insight.event] = (eventCounts[insight.event] ?? 0) + 1;

    if (insight.bookingLinkClicked || insight.event === "booking_link_clicked") {
      bookingLinkClicks += 1;
    }

    if (insight.leadFormOpened || insight.event === "lead_form_opened") {
      leadFormOpened += 1;
    }
    if (
      insight.leadFormSubmitted ||
      insight.event === "lead_submitted" ||
      insight.event === "lead_form_submitted"
    ) {
      leadFormSubmitted += 1;
    }
    if (
      insight.resourceRecommended ||
      insight.event === "resource_recommended"
    ) {
      resourceRecommended += 1;
    }

    for (const intent of insight.detectedIntent ?? []) {
      intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
    }

    if (insight.topicCategory) {
      topicCounts[insight.topicCategory] = (topicCounts[insight.topicCategory] ?? 0) + 1;
    }
  }

  return {
    totalInsights: insights.length,
    eventCounts,
    intentCounts,
    topicCounts,
    bookingLinkClicks,
    leadFormOpened,
    leadFormSubmitted,
    resourceRecommended,
  };
}
