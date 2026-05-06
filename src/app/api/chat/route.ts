import { readFileSync } from "node:fs";

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { formatClinicKnowledge } from "@/data/knowledge";
import { systemPrompt } from "@/lib/systemPrompt";

export const runtime = "nodejs";

const publicErrorMessage =
  "Sorry, Wendy is having trouble connecting right now. Please try again in a moment, or book directly here: https://windyridgechiropractic.janeapp.com/";

const KNOWLEDGE_FILE_PATHS = [
  new URL("../../../../data/website-knowledge.md", import.meta.url),
  new URL("../../../../data/jane-knowledge.md", import.meta.url),
  new URL("../../../../data/generated/jane-knowledge.md", import.meta.url),
  new URL("../../../../data/blog-knowledge.md", import.meta.url),
  new URL("../../../../data/generated/sitemap-knowledge.md", import.meta.url),
];

const MAX_MARKDOWN_KNOWLEDGE_CHARS = 30000;

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type ChatRequestBody = {
  messages?: ChatMessage[];
  pageContext?: string;
};

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

  return body.messages.filter(isChatMessage);
}

function getPageContext(body: ChatRequestBody) {
  if (typeof body.pageContext !== "string") {
    return "";
  }

  return body.pageContext.trim().slice(0, 1200);
}

function loadMarkdownKnowledge() {
  const content = KNOWLEDGE_FILE_PATHS.map((filePath) => {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch {
      return `# Missing knowledge file\n${filePath} was not found.`;
    }
  })
    .filter(Boolean)
    .join("\n\n---\n\n");

  return content.slice(0, MAX_MARKDOWN_KNOWLEDGE_CHARS);
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
        {
          role: "system",
          content: `Website knowledge loaded from markdown files. Use this for brief, accurate, on-brand answers. When a relevant page URL exists, offer it naturally:\n${loadMarkdownKnowledge()}`,
        },
        ...(pageContext
          ? [
              {
                role: "system" as const,
                content: `Optional page context from the embedded WordPress page. Use this to tailor the answer when relevant, but do not treat it as medical advice or verified clinic policy:\n${pageContext}`,
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
