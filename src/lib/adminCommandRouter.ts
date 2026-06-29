export type AdminCommand =
  | { type: "retrieval_diagnostics"; query: string }
  | { type: "knowledge_sources" }
  | { type: "provider_knowledge"; provider?: string; staleCheck?: boolean; scheduleToday?: boolean }
  | { type: "conversation_review" }
  | { type: "conversation_detail"; reference: string }
  | { type: "system_health" }
  | { type: "analytics_summary"; topTopicsOnly?: boolean };

const ADMIN_COMMAND_START =
  /\b(?:show|run|why|which|who|check|open|give me)\b/i;

const EXPLICIT_ADMIN_COMMAND_START =
  /\b(?:show retrieval matches|show retrieval diagnostics|run rag diagnostics|why did wendy not return|why did wendy not show (?:a )?resource|show active knowledge sources|show knowledge manifest|which file is canonical for blogs|show knowledge index summary|show provider knowledge|show dr\.?\s*claire availability|check for stale dr\.?\s*michelle references|who is in big sky today|show recent wendy conversations|show conversation review|open conversation|show messages for conversation|open recent-\d+|show system health|give me wendy status report|show analytics summary|show top topics)\b/i;

export function normalizeAdminText(message: string) {
  return message
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.!?;:,]+$/, "")
    .trim()
    .toLowerCase();
}

export function looksLikeAdminCommand(message: string) {
  const text = normalizeAdminText(message);

  return ADMIN_COMMAND_START.test(text) && EXPLICIT_ADMIN_COMMAND_START.test(text);
}

export function normalizeAuthenticatedAdminCommand(message: string, adminCode: string) {
  const withoutCode = message
    .split(adminCode)
    .join(" ")
    .replace(/\bmanager\s+code\s*:\s*/gi, " ");
  const normalized = normalizeAdminText(withoutCode);
  const commandStart = normalized.search(EXPLICIT_ADMIN_COMMAND_START);

  return commandStart >= 0 ? normalized.slice(commandStart).trim() : normalized;
}

function cleanQuery(value: string) {
  return value.trim().replace(/[?.!]+$/, "").trim().slice(0, 500);
}

export function parseAdminCommand(message: string): AdminCommand | undefined {
  const text = normalizeAdminText(message);

  // 1. Retrieval diagnostics
  const retrievalPatterns = [
    /^show retrieval matches(?:\s+(?:for|about|on))?(?:\s+(.+))?$/i,
    /^show retrieval diagnostics(?:\s+(?:for|about|on))?(?:\s+(.+))?$/i,
    /^run rag diagnostics(?:\s+(?:for|about|on))?(?:\s+(.+))?$/i,
    /^why did wendy not return(?:\s+(?:for|about|on))?(?:\s+(.+))?$/i,
    /^why did wendy not show (?:a )?resource(?:\s+(?:for|about|on))?(?:\s+(.+))?$/i,
  ];

  for (const pattern of retrievalPatterns) {
    const match = text.match(pattern);

    if (match) {
      return {
        type: "retrieval_diagnostics",
        query: match[1] ? cleanQuery(match[1]) : "",
      };
    }
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
