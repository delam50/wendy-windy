import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const WENDY_CONVERSATION_RETENTION_DAYS = 30;
const MAX_ARCHIVED_MESSAGE_LENGTH = 1600;

type ConversationArchiveInput = {
  sessionId?: string;
  conversationId?: string;
  pageTitle?: string;
  pageUrl?: string;
  inferredTopic?: string;
  detectedIntent?: string;
  preferredLocation?: string;
  suggestedProvider?: string;
  leadSubmitted?: boolean;
  resourceCount?: number;
  bookingClicked?: boolean;
  metadata?: Record<string, unknown>;
};

type ArchiveMessageInput = ConversationArchiveInput & {
  role: "user" | "assistant" | "system";
  content: string;
};

export type WendyConversationSummary = {
  id: string;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  pageTitle?: string;
  pageUrl?: string;
  inferredTopic?: string;
  detectedIntent?: string;
  preferredLocation?: string;
  suggestedProvider?: string;
  leadSubmitted: boolean;
  resourceCount: number;
  bookingClicked: boolean;
  excerpt: string;
};

export type WendyArchivedMessage = {
  id: string;
  createdAt: string;
  role: "user" | "assistant" | "system";
  content: string;
  redacted: boolean;
};

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function redactMessageContent(content: string) {
  let redacted = cleanText(content, MAX_ARCHIVED_MESSAGE_LENGTH);
  let redactedAny = false;

  const replacements: Array<[RegExp, string]> = [
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]"],
    [/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[redacted phone]"],
    [
      /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|circle|cir|trail|trl|way|boulevard|blvd)\b\.?/gi,
      "[redacted address]",
    ],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(redacted)) {
      redactedAny = true;
      redacted = redacted.replace(pattern, replacement);
    }
  }

  return { content: redacted, redacted: redactedAny };
}

function compactMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value == null ||
        Array.isArray(value),
      )
      .map(([key, value]) => [
        key,
        typeof value === "string" ? cleanText(value, 500) : value,
      ]),
  );
}

function buildConversationPatch(input: ConversationArchiveInput) {
  return {
    updated_at: new Date().toISOString(),
    page_title: cleanText(input.pageTitle, 180) || undefined,
    page_url: cleanText(input.pageUrl, 500) || undefined,
    inferred_topic: cleanText(input.inferredTopic, 120) || undefined,
    detected_intent: cleanText(input.detectedIntent, 220) || undefined,
    preferred_location: cleanText(input.preferredLocation, 80) || undefined,
    suggested_provider: cleanText(input.suggestedProvider, 120) || undefined,
    lead_submitted: input.leadSubmitted ? true : undefined,
    resource_count:
      typeof input.resourceCount === "number" && input.resourceCount > 0
        ? Math.max(0, Math.floor(input.resourceCount))
        : undefined,
    booking_clicked: input.bookingClicked ? true : undefined,
    metadata: compactMetadata(input.metadata),
  };
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

export async function ensureWendyConversation(input: ConversationArchiveInput) {
  const supabase = getSupabaseAdmin();
  const sessionId = cleanText(input.sessionId, 120);

  if (!supabase || !sessionId) {
    return { persisted: false, reason: "supabase_or_session_missing" };
  }

  try {
    const patch = removeUndefinedValues(buildConversationPatch(input));

    if (input.conversationId) {
      const { data, error } = await supabase
        .from("wendy_conversations")
        .update(patch)
        .eq("id", input.conversationId)
        .select("id")
        .maybeSingle<{ id: string }>();

      if (!error && data?.id) {
        return { persisted: true, conversationId: data.id };
      }
    }

    const { data: existing, error: readError } = await supabase
      .from("wendy_conversations")
      .select("id,metadata")
      .eq("session_id", sessionId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; metadata: Record<string, unknown> | null }>();

    if (readError) {
      console.error("Wendy conversation archive lookup failed:", readError.message);
    }

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("wendy_conversations")
        .update({
          ...patch,
          metadata: {
            ...(existing.metadata ?? {}),
            ...compactMetadata(input.metadata),
          },
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("Wendy conversation archive update failed:", updateError.message);
        return { persisted: false, reason: "conversation_update_failed" };
      }

      return { persisted: true, conversationId: existing.id };
    }

    const { data, error } = await supabase
      .from("wendy_conversations")
      .insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        ...patch,
        metadata: compactMetadata(input.metadata),
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      console.error("Wendy conversation archive create failed:", error.message);
      return { persisted: false, reason: "conversation_create_failed" };
    }

    return { persisted: true, conversationId: data?.id };
  } catch (error) {
    console.error("Wendy conversation archive failed:", error);
    return { persisted: false, reason: "conversation_archive_failed" };
  }
}

export async function archiveWendyMessage(input: ArchiveMessageInput) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return { persisted: false, reason: "supabase_not_configured" };
  }

  const conversation = await ensureWendyConversation(input);
  const conversationId = conversation.conversationId;
  const sessionId = cleanText(input.sessionId, 120);

  if (!conversationId || !sessionId) {
    return { persisted: false, reason: "conversation_missing" };
  }

  const redactedMessage = redactMessageContent(input.content);

  try {
    const { error } = await supabase.from("wendy_messages").insert({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      session_id: sessionId,
      role: input.role,
      content: redactedMessage.content,
      redacted: redactedMessage.redacted,
      metadata: compactMetadata({
        ...input.metadata,
        archivedFor: "short_term_qa_review",
        maxRetentionDays: WENDY_CONVERSATION_RETENTION_DAYS,
      }),
    });

    if (error) {
      console.error("Wendy message archive write failed:", error.message);
      return { persisted: false, reason: "message_archive_write_failed" };
    }

    return { persisted: true, conversationId };
  } catch (error) {
    console.error("Wendy message archive failed:", error);
    return { persisted: false, reason: "message_archive_failed" };
  }
}

export async function updateWendyConversationFromInsight(
  input: ConversationArchiveInput,
) {
  if (!input.sessionId && !input.conversationId) {
    return { persisted: false, reason: "conversation_reference_missing" };
  }

  return ensureWendyConversation(input);
}

export async function getRecentWendyConversationSummaries(input: {
  topic?: string;
  leadOnly?: boolean;
  resourcesOnly?: boolean;
  limit?: number;
}) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return { available: false, conversations: [] as WendyConversationSummary[] };
  }

  const limit = Math.min(Math.max(input.limit ?? 8, 1), 12);
  let query = supabase
    .from("wendy_conversations")
    .select(
      "id,created_at,updated_at,session_id,page_title,page_url,inferred_topic,detected_intent,preferred_location,suggested_provider,lead_submitted,resource_count,booking_clicked",
    )
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (input.leadOnly) {
    query = query.eq("lead_submitted", true);
  }

  if (input.resourcesOnly) {
    query = query.gt("resource_count", 0);
  }

  if (input.topic) {
    query = query.or(
      `inferred_topic.ilike.%${input.topic}%,detected_intent.ilike.%${input.topic}%`,
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("Wendy conversation review query failed:", error.message);
    return { available: false, conversations: [] as WendyConversationSummary[] };
  }

  const conversations = await Promise.all(
    (data ?? []).map(async (conversation) => {
      const { data: messages } = await supabase
        .from("wendy_messages")
        .select("content,role,created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(2);
      const excerpt =
        messages
          ?.map((message) => `${message.role}: ${cleanText(message.content, 220)}`)
          .reverse()
          .join(" | ") || "No archived message excerpt available";

      return {
        id: String(conversation.id),
        createdAt: String(conversation.created_at),
        updatedAt: String(conversation.updated_at),
        sessionId: cleanText(conversation.session_id, 120) || undefined,
        pageTitle: cleanText(conversation.page_title, 180) || undefined,
        pageUrl: cleanText(conversation.page_url, 500) || undefined,
        inferredTopic: cleanText(conversation.inferred_topic, 120) || undefined,
        detectedIntent: cleanText(conversation.detected_intent, 220) || undefined,
        preferredLocation: cleanText(conversation.preferred_location, 80) || undefined,
        suggestedProvider: cleanText(conversation.suggested_provider, 120) || undefined,
        leadSubmitted: Boolean(conversation.lead_submitted),
        resourceCount: Number(conversation.resource_count ?? 0),
        bookingClicked: Boolean(conversation.booking_clicked),
        excerpt,
      };
    }),
  );

  return { available: true, conversations };
}

export async function getConversationMessages(conversationId: string) {
  const supabase = getSupabaseAdmin();
  const normalizedConversationId = cleanText(conversationId, 80);

  if (!supabase || !normalizedConversationId) {
    return {
      available: false,
      found: false,
      conversation: null,
      messages: [] as WendyArchivedMessage[],
    };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("wendy_conversations")
    .select(
      "id,created_at,updated_at,session_id,page_title,page_url,inferred_topic,detected_intent,preferred_location,suggested_provider,lead_submitted,resource_count,booking_clicked",
    )
    .eq("id", normalizedConversationId)
    .maybeSingle();

  if (conversationError) {
    console.error("Wendy conversation detail query failed:", conversationError.message);
    return {
      available: false,
      found: false,
      conversation: null,
      messages: [] as WendyArchivedMessage[],
    };
  }

  if (!conversation) {
    return {
      available: true,
      found: false,
      conversation: null,
      messages: [] as WendyArchivedMessage[],
    };
  }

  const { data: messages, error: messagesError } = await supabase
    .from("wendy_messages")
    .select("id,created_at,role,content,redacted")
    .eq("conversation_id", normalizedConversationId)
    .order("created_at", { ascending: true })
    .limit(60);

  if (messagesError) {
    console.error("Wendy conversation messages query failed:", messagesError.message);
    return {
      available: false,
      found: true,
      conversation: null,
      messages: [] as WendyArchivedMessage[],
    };
  }

  return {
    available: true,
    found: true,
    conversation: {
      id: String(conversation.id),
      createdAt: String(conversation.created_at),
      updatedAt: String(conversation.updated_at),
      sessionId: cleanText(conversation.session_id, 120) || undefined,
      pageTitle: cleanText(conversation.page_title, 180) || undefined,
      pageUrl: cleanText(conversation.page_url, 500) || undefined,
      inferredTopic: cleanText(conversation.inferred_topic, 120) || undefined,
      detectedIntent: cleanText(conversation.detected_intent, 220) || undefined,
      preferredLocation: cleanText(conversation.preferred_location, 80) || undefined,
      suggestedProvider: cleanText(conversation.suggested_provider, 120) || undefined,
      leadSubmitted: Boolean(conversation.lead_submitted),
      resourceCount: Number(conversation.resource_count ?? 0),
      bookingClicked: Boolean(conversation.booking_clicked),
      excerpt: "",
    } satisfies WendyConversationSummary,
    messages:
      messages?.map((message) => ({
        id: String(message.id),
        createdAt: String(message.created_at),
        role:
          message.role === "assistant" || message.role === "system"
            ? message.role
            : "user",
        content: cleanText(message.content, 1800),
        redacted: Boolean(message.redacted),
      })) ?? [],
  };
}

export async function deleteExpiredWendyConversations(
  retentionDays = WENDY_CONVERSATION_RETENTION_DAYS,
) {
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return { deleted: false, reason: "supabase_not_configured" };
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    .toISOString();
  const { error } = await supabase
    .from("wendy_conversations")
    .delete()
    .lt("created_at", cutoff);

  if (error) {
    console.error("Wendy conversation retention cleanup failed:", error.message);
    return { deleted: false, reason: "cleanup_failed" };
  }

  return { deleted: true };
}
