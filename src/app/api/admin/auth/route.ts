import {
  adminUnauthorizedResponse,
  isValidWendyAdminCode,
} from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: unknown };

  if (!isValidWendyAdminCode(body.code)) {
    return adminUnauthorizedResponse();
  }

  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
