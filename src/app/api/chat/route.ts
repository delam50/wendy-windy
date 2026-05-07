import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { formatClinicKnowledge } from "@/data/knowledge";
import { retrieveKnowledge } from "@/lib/retrieveKnowledge";
import { systemPrompt } from "@/lib/systemPrompt";

export const runtime = "nodejs";

const publicErrorMessage =
  "Sorry, Wendy is having trouble connecting right now. Please try again in a moment, or book directly here: https://windyridgechiropractic.janeapp.com/";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type SessionMemory = {
  concern?: string;
  preferredLocation?: "Bozeman" | "Big Sky";
  discussedPricing?: boolean;
  bookingInfoProvided?: boolean;
  bookingLinkClicked?: boolean;
};

type ChatRequestBody = {
  messages?: ChatMessage[];
  pageContext?: string;
  pageTitle?: string;
  pageUrl?: string;
  sessionMemory?: SessionMemory;
};

const MAX_API_MESSAGES = 10;

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Record<string, unknown>;

  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0
  );
}

function getMessages(body: ChatRequestBody): ChatMessage[] {
  if (!Array.isArray(body.messages)) {
    return [];
  }

  return body.messages.filter(isChatMessage).slice(-MAX_API_MESSAGES);
}

function sanitizeContextValue(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function getPageContext(body: ChatRequestBody) {
  const pageTitle = sanitizeContextValue(body.pageTitle, 180);
  const pageUrl = sanitizeContextValue(body.pageUrl, 500);
  const legacyPageContext = sanitizeContextValue(body.pageContext, 1200);
  const pageDetails = [
    pageTitle ? `Page title: ${pageTitle}` : "",
    pageUrl ? `Page URL: ${pageUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [legacyPageContext, pageDetails].filter(Boolean).join("\n").slice(0, 1200);
}

function getRetrievalQuery(messages: ChatMessage[]) {
  const latestUserMessage = messages.findLast((message) => message.role === "user");
  const recentContext = messages
    .slice(-4)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [latestUserMessage?.content ?? "", recentContext].filter(Boolean).join("\n");
}

function getSessionMemory(body: ChatRequestBody): SessionMemory {
  const memory = body.sessionMemory;

  if (!memory || typeof memory !== "object") {
    return {};
  }

  return {
    concern: sanitizeContextValue(memory.concern, 80) || undefined,
    preferredLocation:
      memory.preferredLocation === "Bozeman" || memory.preferredLocation === "Big Sky"
        ? memory.preferredLocation
        : undefined,
    discussedPricing: Boolean(memory.discussedPricing),
    bookingInfoProvided: Boolean(memory.bookingInfoProvided),
    bookingLinkClicked: Boolean(memory.bookingLinkClicked),
  };
}

function formatSessionMemory(memory: SessionMemory) {
  const memoryLines = [
    memory.concern ? `Previously mentioned general concern: ${memory.concern}` : "",
    memory.preferredLocation
      ? `Preferred location mentioned this session: ${memory.preferredLocation}`
      : "",
    memory.discussedPricing ? "Pricing or insurance has already been discussed." : "",
    memory.bookingInfoProvided
      ? "JaneApp booking information has already been provided this session."
      : "",
    memory.bookingLinkClicked
      ? "The visitor has already clicked a booking link this session."
      : "",
  ].filter(Boolean);

  if (memoryLines.length === 0) {
    return "";
  }

  return `Session memory for this browser session only. Use it to avoid repeating yourself, but do not treat it as a medical record or long-term stored health history:\n${memoryLines.join("\n")}`;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;

  if (!apiKey) {
    return Response.json({ error: publicErrorMessage }, { status: 500 });
  }

  if (!model) {
    return Response.json({ error: publicErrorMessage }, { status: 500 });
  }

  const openai = new OpenAI({ apiKey });

  const body = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const messages = getMessages(body);
  const pageContext = getPageContext(body);
  const sessionMemory = getSessionMemory(body);
  const sessionMemoryContext = formatSessionMemory(sessionMemory);
  const retrievedKnowledge = retrieveKnowledge({
    query: getRetrievalQuery(messages),
    conversationContext: sessionMemoryContext,
    pageContext,
  });

  if (messages.length === 0) {
    return Response.json(
      { error: "Please send Wendy a message to get started." },
      { status: 400 },
    );
  }

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: formatClinicKnowledge() },
        ...(sessionMemoryContext
          ? [
              {
                role: "system" as const,
                content: sessionMemoryContext,
              },
            ]
          : []),
        ...(retrievedKnowledge
          ? [
              {
                role: "system" as const,
                content: `Retrieved Windy Ridge website and JaneApp knowledge for this user message. Treat this as general website information, answer briefly, and offer source URLs naturally when useful. If a chunk is marked as the primary related resource, you may recommend that one resource after answering, using a natural line like "We actually have an article on that here if you'd like to read more." Do not recommend more than one resource link. For current booking, availability, appointment details, and pricing confirmation, recommend JaneApp because listed details can change:\n${retrievedKnowledge}`,
              },
            ]
          : []),
        ...(pageContext
          ? [
              {
                role: "system" as const,
                content: `Optional page context from the embedded WordPress page. Use this subtly only when it is clearly relevant to the user's question. It is okay to say things like "Looks like you're reading about neck pain" or mention Big Sky booking on a Big Sky page, but do not overdo it, sound creepy, or treat the page context as medical advice or verified clinic policy:\n${pageContext}`,
              },
            ]
          : []),
        ...messages,
      ] satisfies ChatCompletionMessageParam[],
    });

    const message = completion.choices[0]?.message.content;

    if (!message) {
      return Response.json({ error: publicErrorMessage }, { status: 502 });
    }

    return Response.json({ message });
  } catch (error) {
    console.error("OpenAI chat request failed:", error);
    return Response.json({ error: publicErrorMessage }, { status: 502 });
  }
}
