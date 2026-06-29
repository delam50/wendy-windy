import {
  adminUnauthorizedResponse,
  isValidWendyAdminCode,
} from "@/lib/adminAuth";
import { getConversationMessages } from "@/lib/conversationArchive";
import {
  getManagerOverview,
  inspectManagerProviderRouting,
  inspectManagerRag,
} from "@/lib/managerDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardRequest = {
  code?: unknown;
  action?: unknown;
  query?: unknown;
  conversationId?: unknown;
};

function cleanString(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength)
    : "";
}

function dashboardResponse(data: unknown) {
  return Response.json(
    { ok: true, data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as DashboardRequest;

  if (!isValidWendyAdminCode(body.code)) {
    return adminUnauthorizedResponse();
  }

  const action = cleanString(body.action, 40) || "overview";

  if (action === "overview") {
    return dashboardResponse(await getManagerOverview());
  }

  if (action === "rag") {
    const query = cleanString(body.query, 500);
    if (!query) {
      return Response.json(
        { ok: false, error: "Enter a query to inspect." },
        { status: 400 },
      );
    }
    return dashboardResponse(inspectManagerRag(query));
  }

  if (action === "provider") {
    const query = cleanString(body.query, 500);
    if (!query) {
      return Response.json(
        { ok: false, error: "Enter an example patient question." },
        { status: 400 },
      );
    }
    return dashboardResponse(inspectManagerProviderRouting(query));
  }

  if (action === "conversation") {
    const conversationId = cleanString(body.conversationId, 80);
    if (!conversationId) {
      return Response.json(
        { ok: false, error: "Conversation ID is required." },
        { status: 400 },
      );
    }
    const result = await getConversationMessages(conversationId);
    return dashboardResponse({
      available: result.available,
      found: result.found,
      conversation: result.conversation
        ? {
            id: result.conversation.id,
            createdAt: result.conversation.createdAt,
            updatedAt: result.conversation.updatedAt,
            pageTitle: result.conversation.pageTitle,
            pageUrl: result.conversation.pageUrl,
            inferredTopic: result.conversation.inferredTopic,
            detectedIntent: result.conversation.detectedIntent,
          }
        : null,
      messages: result.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          id: message.id,
          createdAt: message.createdAt,
          role: message.role,
          content: message.content,
          redacted: message.redacted,
        })),
    });
  }

  return Response.json(
    { ok: false, error: "Unknown dashboard action." },
    { status: 400 },
  );
}
