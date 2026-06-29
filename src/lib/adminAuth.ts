import { timingSafeEqual } from "node:crypto";

export function isValidWendyAdminCode(value: unknown) {
  const configuredCode = process.env.WENDY_ADMIN_CODE?.trim();
  const suppliedCode = typeof value === "string" ? value.trim() : "";

  if (!configuredCode || !suppliedCode) return false;

  const configuredBuffer = Buffer.from(configuredCode);
  const suppliedBuffer = Buffer.from(suppliedCode);

  return configuredBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(configuredBuffer, suppliedBuffer);
}

export function adminUnauthorizedResponse() {
  return Response.json(
    { ok: false, error: "Manager authorization required." },
    { status: 401 },
  );
}
