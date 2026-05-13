import type { ConversationInsightEvent } from "@/lib/conversationInsights";
import { logConversationInsight } from "@/lib/conversationInsights";

export const runtime = "nodejs";

type InsightRequestBody = {
  event?: ConversationInsightEvent;
  timestamp?: string;
  metadata?: {
    pageTitle?: string;
    pageUrl?: string;
    quickActionLabel?: string;
    bookingLinkClicked?: boolean;
    leadLocationPreference?: string;
    errorType?: string;
    source?: string;
    resourceTitle?: string;
    resourceUrl?: string;
  };
};

const allowedEvents = new Set<ConversationInsightEvent>([
  "widget_loaded",
  "widget_opened",
  "widget_closed",
  "message_sent",
  "assistant_response_received",
  "quick_action_clicked",
  "resource_recommended",
  "resource_clicked",
  "resource_link_clicked",
  "booking_link_clicked",
  "lead_form_opened",
  "lead_submitted",
  "lead_form_submitted",
  "error_shown",
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as InsightRequestBody;

    if (!body.event || !allowedEvents.has(body.event)) {
      return Response.json({ ok: true, persisted: false, reason: "ignored_event" });
    }

    const metadata = body.metadata ?? {};

    const result = await logConversationInsight({
      event: body.event,
      timestamp: body.timestamp,
      pageTitle: metadata.pageTitle,
      pageUrl: metadata.pageUrl,
      bookingLinkClicked: Boolean(metadata.bookingLinkClicked),
      leadFormOpened: body.event === "lead_form_opened",
      leadFormSubmitted:
        body.event === "lead_submitted" ||
        body.event === "lead_form_submitted",
      resourceRecommended: body.event === "resource_recommended",
      metadata: {
        quickActionLabel: metadata.quickActionLabel,
        leadLocationPreference: metadata.leadLocationPreference,
        source: metadata.source,
        errorType: metadata.errorType,
        resourceTitle: metadata.resourceTitle,
        resourceUrl: metadata.resourceUrl,
      },
    });

    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("Wendy conversation insight logging failed:", error);
    return Response.json({ ok: true, persisted: false, reason: "logging_failed" });
  }
}
