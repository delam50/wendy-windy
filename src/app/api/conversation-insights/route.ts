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
  };
};

const allowedEvents = new Set<ConversationInsightEvent>([
  "widget_opened",
  "widget_closed",
  "message_sent",
  "assistant_response_received",
  "quick_action_clicked",
  "booking_link_clicked",
  "lead_form_opened",
  "lead_form_submitted",
  "error_shown",
]);

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as InsightRequestBody;

  if (!body.event || !allowedEvents.has(body.event)) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const metadata = body.metadata ?? {};

  try {
    await logConversationInsight({
      event: body.event,
      timestamp: body.timestamp,
      pageTitle: metadata.pageTitle,
      pageUrl: metadata.pageUrl,
      bookingLinkClicked: Boolean(metadata.bookingLinkClicked),
      leadFormOpened: body.event === "lead_form_opened",
      leadFormSubmitted: body.event === "lead_form_submitted",
      metadata: {
        quickActionLabel: metadata.quickActionLabel,
        leadLocationPreference: metadata.leadLocationPreference,
        source: metadata.source,
        errorType: metadata.errorType,
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Wendy conversation insight logging failed:", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
