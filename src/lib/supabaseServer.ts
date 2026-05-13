import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedSupabase: SupabaseClient | null | undefined;

type WendyEventInput = {
  eventName: string;
  pageTitle?: string;
  pageUrl?: string;
  topicCategory?: string;
  intent?: string;
  resourceTitle?: string;
  resourceUrl?: string;
  preferredLocation?: string;
  suggestedProvider?: string;
  metadata?: Record<string, unknown>;
};

type WendyLeadInput = {
  name: string;
  email?: string;
  phone?: string;
  preferredLocation: string;
  generalConcern?: string;
  preferredTiming?: string;
  suggestedProvider?: string;
  pageTitle?: string;
  pageUrl?: string;
  source: string;
  metadata?: Record<string, unknown>;
};

const funnelEventNames = [
  "widget_loaded",
  "widget_opened",
  "message_sent",
  "assistant_response_received",
  "resource_recommended",
  "resource_clicked",
  "booking_link_clicked",
  "lead_form_opened",
  "lead_submitted",
] as const;

type FunnelEventName = (typeof funnelEventNames)[number];
type FunnelCounts = Record<FunnelEventName, number>;

type WendyEventRow = {
  event_name: string | null;
  page_title: string | null;
  page_url: string | null;
  resource_title: string | null;
  resource_url: string | null;
  topic_category: string | null;
};

function createEmptyFunnelCounts(): FunnelCounts {
  return Object.fromEntries(
    funnelEventNames.map((eventName) => [eventName, 0]),
  ) as FunnelCounts;
}

function normalizeFunnelEventName(eventName: string | null | undefined) {
  if (eventName === "resource_link_clicked") return "resource_clicked";
  if (eventName === "lead_form_submitted") return "lead_submitted";

  return funnelEventNames.includes(eventName as FunnelEventName)
    ? (eventName as FunnelEventName)
    : undefined;
}

function sortCountEntries<T extends { count: number }>(items: T[]) {
  return items.sort((first, second) => second.count - first.count);
}

function summarizeFunnelEvents(events: WendyEventRow[] = []) {
  const funnelCounts = createEmptyFunnelCounts();
  const pageOpenCounts = new Map<
    string,
    { pageTitle?: string; pageUrl?: string; count: number }
  >();
  const resourceClickCounts = new Map<
    string,
    { title?: string; url?: string; count: number }
  >();
  const recentResourceClicks: WendyEventRow[] = [];
  const recentBookingClicks: WendyEventRow[] = [];

  for (const event of events) {
    const funnelEventName = normalizeFunnelEventName(event.event_name);

    if (funnelEventName) {
      funnelCounts[funnelEventName] += 1;
    }

    if (funnelEventName === "widget_opened") {
      const key = event.page_url || event.page_title || "Unknown page";
      const existing = pageOpenCounts.get(key);
      pageOpenCounts.set(key, {
        pageTitle: event.page_title || existing?.pageTitle || undefined,
        pageUrl: event.page_url || existing?.pageUrl || undefined,
        count: (existing?.count ?? 0) + 1,
      });
    }

    if (funnelEventName === "resource_clicked") {
      if (recentResourceClicks.length < 5) {
        recentResourceClicks.push(event);
      }

      const key = event.resource_url || event.resource_title || "Unknown resource";
      const existing = resourceClickCounts.get(key);
      resourceClickCounts.set(key, {
        title: event.resource_title || existing?.title || undefined,
        url: event.resource_url || existing?.url || undefined,
        count: (existing?.count ?? 0) + 1,
      });
    }

    if (funnelEventName === "booking_link_clicked" && recentBookingClicks.length < 5) {
      recentBookingClicks.push(event);
    }
  }

  return {
    funnelCounts,
    topPagesByWidgetOpens: sortCountEntries(Array.from(pageOpenCounts.values()))
      .slice(0, 5),
    topClickedResources: sortCountEntries(Array.from(resourceClickCounts.values()))
      .slice(0, 5),
    recentResourceClicks,
    recentBookingClicks,
  };
}

export function isSupabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (cachedSupabase !== undefined) {
    return cachedSupabase;
  }

  cachedSupabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return cachedSupabase;
}

export async function writeWendyEvent(input: WendyEventInput) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return { persisted: false, reason: "supabase_not_configured" };
  }

  const { error } = await supabase.from("wendy_events").insert({
    event_name: input.eventName,
    page_title: input.pageTitle || null,
    page_url: input.pageUrl || null,
    topic_category: input.topicCategory || null,
    intent: input.intent || null,
    resource_title: input.resourceTitle || null,
    resource_url: input.resourceUrl || null,
    preferred_location: input.preferredLocation || null,
    suggested_provider: input.suggestedProvider || null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    console.error("Wendy Supabase event write failed:", error.message);
    return { persisted: false, reason: "supabase_event_write_failed" };
  }

  return { persisted: true };
}

export async function writeWendyLead(input: WendyLeadInput) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return { persisted: false, reason: "supabase_not_configured" };
  }

  const { data, error } = await supabase
    .from("wendy_leads")
    .insert({
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      preferred_location: input.preferredLocation,
      general_concern: input.generalConcern || null,
      preferred_timing: input.preferredTiming || null,
      suggested_provider: input.suggestedProvider || null,
      page_title: input.pageTitle || null,
      page_url: input.pageUrl || null,
      source: input.source,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error("Wendy Supabase lead write failed:", error.message);
    return { persisted: false, reason: "supabase_lead_write_failed" };
  }

  return { persisted: true, id: data?.id };
}

export async function updateWendyLeadMondayItemId(
  leadId: string | undefined,
  mondayItemId: string,
) {
  const supabase = getSupabaseAdmin();

  if (!supabase || !leadId) {
    return { updated: false, reason: "supabase_not_configured_or_missing_id" };
  }

  const { error } = await supabase
    .from("wendy_leads")
    .update({ monday_item_id: mondayItemId })
    .eq("id", leadId);

  if (error) {
    console.error("Wendy Supabase Monday item update failed:", error.message);
    return { updated: false, reason: "supabase_monday_update_failed" };
  }

  return { updated: true };
}

export async function incrementWendyTopicCount(topic: string) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return { persisted: false, reason: "supabase_not_configured" };
  }

  const { data, error: readError } = await supabase
    .from("wendy_topic_counts")
    .select("topic_category,count")
    .eq("topic_category", topic)
    .maybeSingle<{ topic_category: string; count: number | null }>();

  if (readError) {
    console.error("Wendy Supabase topic count read failed:", readError.message);
    return { persisted: false, reason: "supabase_topic_read_failed" };
  }

  const nextCount = (data?.count ?? 0) + 1;
  const { error: writeError } = await supabase
    .from("wendy_topic_counts")
    .upsert(
      {
        topic_category: topic,
        count: nextCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "topic_category" },
    );

  if (writeError) {
    console.error("Wendy Supabase topic count write failed:", writeError.message);
    return { persisted: false, reason: "supabase_topic_write_failed" };
  }

  return { persisted: true, count: nextCount };
}

async function getTableCount(tableName: string) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return 0;
  }

  const { count, error } = await supabase
    .from(tableName)
    .select("*", { count: "exact", head: true });

  if (error) {
    return 0;
  }

  return count ?? 0;
}

export async function getSupabaseDiagnostics() {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    const emptyFunnel = summarizeFunnelEvents();

    return {
      configured: false,
      healthy: false,
      totalEvents: 0,
      totalLeads: 0,
      funnelCounts: emptyFunnel.funnelCounts,
      topPagesByWidgetOpens: emptyFunnel.topPagesByWidgetOpens,
      topTopics: [] as Array<{ topic: string; count: number }>,
      topClickedResources: emptyFunnel.topClickedResources,
      recentResourceClicks: emptyFunnel.recentResourceClicks,
      recentBookingClicks: emptyFunnel.recentBookingClicks,
    };
  }

  const [totalEvents, totalLeads, topics, events] =
    await Promise.all([
      getTableCount("wendy_events"),
      getTableCount("wendy_leads"),
      supabase
        .from("wendy_topic_counts")
        .select("topic_category,count")
        .order("count", { ascending: false })
        .limit(5),
      supabase
        .from("wendy_events")
        .select("event_name,page_title,page_url,resource_title,resource_url,topic_category")
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);
  const eventSummary = summarizeFunnelEvents((events.data ?? []) as WendyEventRow[]);

  return {
    configured: true,
    healthy: !topics.error && !events.error,
    totalEvents,
    totalLeads,
    funnelCounts: eventSummary.funnelCounts,
    topPagesByWidgetOpens: eventSummary.topPagesByWidgetOpens,
    topTopics:
      topics.data?.map((topic) => ({
        topic: String(topic.topic_category),
        count: Number(topic.count ?? 0),
      })) ?? [],
    topClickedResources: eventSummary.topClickedResources,
    recentResourceClicks: eventSummary.recentResourceClicks,
    recentBookingClicks: eventSummary.recentBookingClicks,
  };
}
