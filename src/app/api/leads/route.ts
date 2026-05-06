import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

type LeadRequestBody = {
  name?: string;
  phone?: string;
  email?: string;
  location?: string;
  mainConcern?: string;
  preferredTiming?: string;
  pageTitle?: string;
  pageUrl?: string;
};

type LeadRecord = Required<LeadRequestBody> & {
  id: string;
  createdAt: string;
  source: "wendy-chat";
  status: "new";
};

const leadsFilePath = path.join(process.cwd(), "data", "generated", "leads.json");

function sanitize(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function normalizeLead(body: LeadRequestBody) {
  return {
    name: sanitize(body.name, 120),
    phone: sanitize(body.phone, 80),
    email: sanitize(body.email, 160),
    location: sanitize(body.location, 40),
    mainConcern: sanitize(body.mainConcern, 280),
    preferredTiming: sanitize(body.preferredTiming, 160),
    pageTitle: sanitize(body.pageTitle, 180),
    pageUrl: sanitize(body.pageUrl, 500),
  };
}

function validateLead(lead: ReturnType<typeof normalizeLead>) {
  const errors: string[] = [];

  if (!lead.name) {
    errors.push("Name is required.");
  }

  if (!lead.phone && !lead.email) {
    errors.push("Please include either a phone number or email.");
  }

  if (lead.location !== "Bozeman" && lead.location !== "Big Sky") {
    errors.push("Please choose Bozeman or Big Sky.");
  }

  return errors;
}

async function readExistingLeads() {
  try {
    const file = await readFile(leadsFilePath, "utf8");
    const parsed = JSON.parse(file) as unknown;

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as LeadRequestBody;
  const lead = normalizeLead(body);
  const errors = validateLead(lead);

  if (errors.length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  const leadRecord: LeadRecord = {
    ...lead,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "wendy-chat",
    status: "new",
  };

  await mkdir(path.dirname(leadsFilePath), { recursive: true });

  const existingLeads = await readExistingLeads();
  existingLeads.push(leadRecord);

  await writeFile(leadsFilePath, `${JSON.stringify(existingLeads, null, 2)}\n`);

  // Future integrations can forward leadRecord to Monday.com here.
  console.log("[Wendy lead captured]", {
    id: leadRecord.id,
    location: leadRecord.location,
    hasPhone: Boolean(leadRecord.phone),
    hasEmail: Boolean(leadRecord.email),
  });

  return Response.json({ ok: true });
}
