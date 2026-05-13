export type WendyAnalyticsEventName =
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

export type WendyAnalyticsMetadata = {
  pageTitle?: string;
  pageUrl?: string;
  quickActionLabel?: string;
  bookingLinkClicked?: boolean;
  leadLocationPreference?: string;
  messageLength?: number;
  assistantResponseLength?: number;
  errorType?: string;
  source?: string;
  resourceTitle?: string;
  resourceUrl?: string;
};

export type WendyAnalyticsEvent = {
  event: WendyAnalyticsEventName;
  timestamp: string;
  metadata: WendyAnalyticsMetadata;
};

export function trackAnalyticsEvent(
  event: WendyAnalyticsEventName,
  metadata: WendyAnalyticsMetadata = {},
) {
  const analyticsEvent: WendyAnalyticsEvent = {
    event,
    timestamp: new Date().toISOString(),
    metadata,
  };

  // Future adapters can forward this to Google Analytics, Monday.com,
  // Vercel Analytics, or a custom dashboard from this single handoff point.
  console.log("[Wendy analytics]", analyticsEvent);

  if (typeof window === "undefined") {
    return;
  }

  void fetch("/api/conversation-insights", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(analyticsEvent),
  }).catch(() => {
    // Analytics should never interrupt the visitor experience.
  });
}
