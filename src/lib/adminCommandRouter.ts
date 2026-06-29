export type AdminCommand =
  | { type: "retrieval_diagnostics"; query: string }
  | { type: "knowledge_sources" }
  | { type: "provider_knowledge"; provider?: string; staleCheck?: boolean; scheduleToday?: boolean }
  | { type: "conversation_review" }
  | { type: "conversation_detail"; reference: string }
  | { type: "system_health" }
  | { type: "analytics_summary"; topTopicsOnly?: boolean };

const ADMIN_COMMAND_START =
  /^(?:show|run|why|which|who|check|open|give me)\b/i;

export function looksLikeAdminCommand(message: string) {
  const text = message.trim();

  return ADMIN_COMMAND_START.test(text) && /\b(?:retrieval|rag|resource|knowledge|canonical|provider|availability|stale|conversation|messages|recent-\d+|system health|status report|analytics|top topics)\b/i.test(text);
}

export function removeAdminCode(message: string, adminCode: string) {
  return message.split(adminCode).join(" ").replace(/\s+/g, " ").trim();
}

function cleanQuery(value: string) {
  return value.trim().replace(/[?.!]+$/, "").trim().slice(0, 500);
}

export function parseAdminCommand(message: string): AdminCommand | undefined {
  const text = message.trim().replace(/[.!?]+$/, "").trim();

  // 1. Retrieval diagnostics
  const retrievalPatterns = [
    /^show retrieval matches for\s+(.+)$/i,
    /^show retrieval diagnostics for\s+(.+)$/i,
    /^run rag diagnostics for\s+(.+)$/i,
    /^why did wendy not return\s+(.+)$/i,
    /^why did wendy not show (?:a )?resource for\s+(.+)$/i,
  ];

  for (const pattern of retrievalPatterns) {
    const match = text.match(pattern);
    const query = match?.[1] ? cleanQuery(match[1]) : "";

    if (query) return { type: "retrieval_diagnostics", query };
  }

  // 2. Knowledge source diagnostics
  if (/^(?:show active knowledge sources|show knowledge manifest|which file is canonical for blogs\??|show knowledge index summary)$/i.test(text)) {
    return { type: "knowledge_sources" };
  }

  // 3. Provider knowledge diagnostics
  if (/^check for stale dr\.?\s*michelle references$/i.test(text)) {
    return { type: "provider_knowledge", staleCheck: true };
  }

  if (/^who is in big sky today$/i.test(text)) {
    return { type: "provider_knowledge", scheduleToday: true };
  }

  const providerForMatch = text.match(/^show provider knowledge for\s+(.+)$/i);
  if (providerForMatch?.[1]) {
    return {
      type: "provider_knowledge",
      provider: cleanQuery(providerForMatch[1]),
    };
  }

  const providerAvailabilityMatch = text.match(/^show\s+(.+?)\s+availability$/i);
  if (providerAvailabilityMatch?.[1]) {
    return {
      type: "provider_knowledge",
      provider: cleanQuery(providerAvailabilityMatch[1]),
    };
  }

  if (/^show provider knowledge$/i.test(text)) {
    return { type: "provider_knowledge" };
  }

  // 4. Conversation review (list only; never topic/retrieval matching)
  if (/^(?:show recent wendy conversations|show conversation review)$/i.test(text)) {
    return { type: "conversation_review" };
  }

  // 5. Conversation detail lookup
  const detailMatch = text.match(
    /^(?:open conversation|show messages for conversation)\s+([0-9a-f-]{6,})$/i,
  );
  if (detailMatch?.[1]) {
    return { type: "conversation_detail", reference: detailMatch[1] };
  }

  const recentMatch = text.match(/^open\s+(recent-\d+)$/i);
  if (recentMatch?.[1]) {
    return { type: "conversation_detail", reference: recentMatch[1].toLowerCase() };
  }

  // 6. System health/status
  if (/^(?:show system health|give me wendy status report)$/i.test(text)) {
    return { type: "system_health" };
  }

  // 7. Analytics/stats
  if (/^show analytics summary$/i.test(text)) {
    return { type: "analytics_summary" };
  }

  if (/^show top topics$/i.test(text)) {
    return { type: "analytics_summary", topTopicsOnly: true };
  }

  return undefined;
}
