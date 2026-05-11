import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import nodemailer from "nodemailer";

import { isProductionRuntime, logConversationInsight } from "@/lib/conversationInsights";
import { writeWendyLead } from "@/lib/supabaseServer";

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
  suggestedProvider?: string;
};

type LeadRecord = Required<LeadRequestBody> & {
  id: string;
  createdAt: string;
  source: "wendy-chat";
  status: "new";
};

const leadsFilePath = path.join(process.cwd(), "data", "generated", "leads.json");
const leadNotificationEmail =
  process.env.LEAD_NOTIFICATION_EMAIL || "frontdesk@windyridgechiropractic.com";

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
    suggestedProvider: sanitize(body.suggestedProvider, 120),
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

function getEmailTransportConfig() {
  const host = process.env.EMAIL_SERVER_HOST;
  const port = Number(process.env.EMAIL_SERVER_PORT);
  const user = process.env.EMAIL_SERVER_USER;
  const pass = process.env.EMAIL_SERVER_PASSWORD;
  const from = process.env.EMAIL_FROM;

  if (!host || !port || !user || !pass || !from) {
    return null;
  }

  return {
    from,
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
      requireTLS: port !== 465,
    }),
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatValue(value: string) {
  return value || "Not provided";
}

function buildLeadEmail(lead: LeadRecord) {
  const rows = [
    ["Visitor name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Preferred location", lead.location],
    ["General concern", lead.mainConcern],
    ["Preferred appointment timing", lead.preferredTiming],
    ["Page URL", lead.pageUrl],
    ["Submitted at", lead.createdAt],
  ];

  const text = [
    "New Wendy lead from Windy Ridge Chiropractic",
    "",
    ...rows.map(([label, value]) => `${label}: ${formatValue(value)}`),
    "",
    "Note: Wendy asks visitors for a brief general concern only and does not request detailed medical history.",
  ].join("\n");

  const htmlRows = rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e6e6e6;font-weight:700;color:#1f1f1f;">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e6e6e6;color:#333;">${escapeHtml(formatValue(value))}</td>
      </tr>`,
    )
    .join("");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;line-height:1.5;">
    <h2 style="margin:0 0 12px;color:#1f1f1f;">New Wendy lead</h2>
    <p style="margin:0 0 16px;color:#555;">A visitor asked Windy Ridge to follow up. Wendy only asks for a brief general concern, not detailed medical history.</p>
    <table style="border-collapse:collapse;width:100%;max-width:680px;border:1px solid #e6e6e6;">${htmlRows}</table>
  </div>`;

  return {
    subject: `New Wendy lead: ${lead.name} - ${lead.location}`,
    text,
    html,
  };
}

async function sendLeadNotification(lead: LeadRecord) {
  const emailConfig = getEmailTransportConfig();

  if (!emailConfig) {
    throw new Error("Email notification is not configured.");
  }

  const email = buildLeadEmail(lead);

  await emailConfig.transporter.sendMail({
    from: emailConfig.from,
    to: leadNotificationEmail,
    replyTo: lead.email || undefined,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
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

  let leadSaved = false;

  const supabaseLeadResult = await writeWendyLead({
    name: leadRecord.name,
    email: leadRecord.email,
    phone: leadRecord.phone,
    preferredLocation: leadRecord.location,
    generalConcern: leadRecord.mainConcern,
    preferredTiming: leadRecord.preferredTiming,
    suggestedProvider: leadRecord.suggestedProvider,
    pageTitle: leadRecord.pageTitle,
    pageUrl: leadRecord.pageUrl,
    source: leadRecord.source,
    metadata: {
      status: leadRecord.status,
      hasPhone: Boolean(leadRecord.phone),
      hasEmail: Boolean(leadRecord.email),
    },
  });

  leadSaved = supabaseLeadResult.persisted;

  if (!isProductionRuntime()) {
    try {
      await mkdir(path.dirname(leadsFilePath), { recursive: true });

      const existingLeads = await readExistingLeads();
      existingLeads.push(leadRecord);

      await writeFile(leadsFilePath, `${JSON.stringify(existingLeads, null, 2)}\n`);
      leadSaved = true;
    } catch (error) {
      console.error("Wendy local lead backup failed:", error);
    }
  }

  let emailSent = false;

  try {
    await sendLeadNotification(leadRecord);
    emailSent = true;
  } catch (error) {
    console.error("Wendy lead email notification failed:", error);
  }

  // Future integrations can forward leadRecord to Monday.com here.
  console.log("[Wendy lead captured]", {
    id: leadRecord.id,
    location: leadRecord.location,
    hasPhone: Boolean(leadRecord.phone),
    hasEmail: Boolean(leadRecord.email),
    emailSent,
    supabaseSaved: supabaseLeadResult.persisted,
  });

  try {
    await logConversationInsight({
      event: "lead_form_submitted",
      pageTitle: leadRecord.pageTitle,
      pageUrl: leadRecord.pageUrl,
      leadFormSubmitted: true,
      topicCategory: "lead follow-up request",
      metadata: {
        leadLocationPreference: leadRecord.location,
        suggestedProvider: leadRecord.suggestedProvider,
        source: "api_leads",
      },
    });
  } catch (error) {
    console.error("Wendy conversation insight logging failed:", error);
  }

  if (!emailSent) {
    return Response.json(
      {
        ok: false,
        leadSaved,
        error:
          "Wendy saved the lead, but the email notification could not be sent.",
      },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, leadSaved, emailSent });
}
