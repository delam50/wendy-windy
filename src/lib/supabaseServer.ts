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

  const { error } = await supabase.from("wendy_leads").insert({
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
  });

  if (error) {
    console.error("Wendy Supabase lead write failed:", error.message);
    return { persisted: false, reason: "supabase_lead_write_failed" };
  }

  return { persisted: true };
}

export async function incrementWendyTopicCount(topic: string) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return { persisted: false, reason: "supabase_not_configured" };
  }

  const { data, error: readError } = await supabase
    .from("wendy_topic_counts")
    .select("topic,count")
    .eq("topic", topic)
    .maybeSingle<{ topic: string; count: number | null }>();

  if (readError) {
    console.error("Wendy Supabase topic count read failed:", readError.message);
    return { persisted: false, reason: "supabase_topic_read_failed" };
  }

  const nextCount = (data?.count ?? 0) + 1;
  const { error: writeError } = await supabase
    .from("wendy_topic_counts")
    .upsert(
      {
        topic,
        count: nextCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "topic" },
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
    return {
      configured: false,
      healthy: false,
      totalEvents: 0,
      totalLeads: 0,
      topTopics: [] as Array<{ topic: string; count: number }>,
      recentResourceClicks: [] as Array<Record<string, unknown>>,
      recentBookingClicks: [] as Array<Record<string, unknown>>,
    };
  }

  const [totalEvents, totalLeads, topics, resourceClicks, bookingClicks] =
    await Promise.all([
      getTableCount("wendy_events"),
      getTableCount("wendy_leads"),
      supabase
        .from("wendy_topic_counts")
        .select("topic,count")
        .order("count", { ascending: false })
        .limit(5),
      supabase
        .from("wendy_events")
        .select("event_name,resource_title,resource_url,topic_category,page_url")
        .in("event_name", ["resource_clicked", "resource_link_clicked"])
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("wendy_events")
        .select("event_name,page_url,topic_category,preferred_location")
        .eq("event_name", "booking_link_clicked")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  return {
    configured: true,
    healthy: !topics.error && !resourceClicks.error && !bookingClicks.error,
    totalEvents,
    totalLeads,
    topTopics:
      topics.data?.map((topic) => ({
        topic: String(topic.topic),
        count: Number(topic.count ?? 0),
      })) ?? [],
    recentResourceClicks: resourceClicks.data ?? [],
    recentBookingClicks: bookingClicks.data ?? [],
  };
}
