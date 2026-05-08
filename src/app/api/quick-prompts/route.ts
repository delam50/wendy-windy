import { getTopQuestionTopics } from "@/lib/conversationInsights";

export const runtime = "nodejs";

export async function GET() {
  try {
    const topics = await getTopQuestionTopics(4);

    return Response.json({
      ok: true,
      topics: topics.map(({ topic, count }) => ({ topic, count })),
    });
  } catch {
    return Response.json({ ok: true, topics: [] });
  }
}
