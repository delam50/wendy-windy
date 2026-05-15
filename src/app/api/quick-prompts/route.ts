import { getTopQuestionTopics } from "@/lib/conversationInsights";
import { getQuickPromptsForContext } from "@/lib/quickPrompts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const topics = await getTopQuestionTopics(4);
    const prompts = getQuickPromptsForContext({
      pageTitle: url.searchParams.get("pageTitle") ?? "",
      pageUrl: url.searchParams.get("pageUrl") ?? "",
      pageContext: url.searchParams.get("pageContext") ?? "",
      usageTopics: topics.map(({ topic, count }) => ({ topic, count })),
    });

    return Response.json({
      ok: true,
      prompts: prompts.actions,
      source: prompts.source,
      topics: topics.map(({ topic, count }) => ({ topic, count })),
    });
  } catch {
    const prompts = getQuickPromptsForContext({});

    return Response.json({
      ok: true,
      prompts: prompts.actions,
      source: prompts.source,
      topics: [],
    });
  }
}
