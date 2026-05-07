import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ConversationInsightEvent =
  | "chat_response"
  | "widget_opened"
  | "widget_closed"
  | "message_sent"
  | "assistant_response_received"
  | "quick_action_clicked"
  | "booking_link_clicked"
  | "lead_form_opened"
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
  };
};

const insightsFilePath = path.join(
  process.cwd(),
  "data",
  "generated",
  "conversation-insights.json",
);
const MAX_INSIGHTS = 1000;

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

async function readExistingInsights() {
  try {
    const file = await readFile(insightsFilePath, "utf8");
    const parsed = JSON.parse(file) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
    },
  };

  await mkdir(path.dirname(insightsFilePath), { recursive: true });

  const existingInsights = await readExistingInsights();
  existingInsights.push(safeInsight);

  await writeFile(
    insightsFilePath,
    `${JSON.stringify(existingInsights.slice(-MAX_INSIGHTS), null, 2)}\n`,
  );
}

// Developer-only review helper:
// import { readConversationInsights } from "@/lib/conversationInsights";
// const insights = await readConversationInsights();
export async function readConversationInsights() {
  return readExistingInsights() as Promise<ConversationInsight[]>;
}
