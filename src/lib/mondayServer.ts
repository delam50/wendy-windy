type MondayLeadInput = {
  name: string;
  phone?: string;
  email?: string;
  preferredLocation?: string;
  generalConcern?: string;
  preferredTiming?: string;
  suggestedProvider?: string;
  pageUrl?: string;
};

const MONDAY_API_URL = "https://api.monday.com/v2";
const DEFAULT_BOARD_ID = "18412623102";
const LOCATION_LABELS = new Set(["Four Corners", "Big Sky"]);
const PROVIDER_LABELS = new Set([
  "Dr. Josh",
  "Dr. Kyle",
  "Dr. Dave",
  "Dr. Claire",
]);
const STATUS_LABELS = new Set(["New", "Contacted", "Closed"]);

function getMondayConfig() {
  const apiKey = process.env.MONDAY_API_KEY;
  const boardId = process.env.MONDAY_BOARD_ID || DEFAULT_BOARD_ID;

  if (!apiKey || !boardId) {
    return null;
  }

  return {
    apiKey,
    boardId,
    columns: {
      timing: process.env.MONDAY_COL_TIMING || "text_mm38t4nz",
      pageUrl: process.env.MONDAY_COL_PAGE_URL || "link_mm38z0hc",
      phone: process.env.MONDAY_COL_PHONE || "phone_mm38n1",
      email: process.env.MONDAY_COL_EMAIL || "text_mm38jnwd",
      location: process.env.MONDAY_COL_LOCATION || "color_mm38546x",
      concern: process.env.MONDAY_COL_CONCERN || "long_text_mm385e6m",
      provider: process.env.MONDAY_COL_PROVIDER || "color_mm382wx5",
      status: process.env.MONDAY_COL_STATUS || "color_mm387nq4",
    },
  };
}

export function isMondayConfigured() {
  return Boolean(getMondayConfig());
}

function normalizeLocationLabel(location: string | undefined) {
  if (location === "Big Sky") {
    return "Big Sky";
  }

  if (location === "Bozeman" || location === "Four Corners") {
    return "Four Corners";
  }

  return "";
}

function normalizeProviderLabel(provider: string | undefined) {
  const normalizedProvider = (provider ?? "").trim();

  return PROVIDER_LABELS.has(normalizedProvider) ? normalizedProvider : "";
}

function getLinkValue(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(url);

    return {
      url: parsedUrl.toString(),
      text: parsedUrl.hostname.replace(/^www\./, ""),
    };
  } catch {
    return undefined;
  }
}

function getPhoneValue(phone: string | undefined) {
  if (!phone) {
    return undefined;
  }

  return {
    phone,
    countryShortName: "US",
  };
}

function buildMondayColumnValues(lead: MondayLeadInput) {
  const config = getMondayConfig();

  if (!config) {
    return {};
  }

  const locationLabel = normalizeLocationLabel(lead.preferredLocation);
  const providerLabel = normalizeProviderLabel(lead.suggestedProvider);
  const statusLabel = "New";
  const columnValues: Record<string, unknown> = {};
  const pageUrl = getLinkValue(lead.pageUrl);
  const phone = getPhoneValue(lead.phone);

  if (lead.preferredTiming) {
    columnValues[config.columns.timing] = lead.preferredTiming;
  }

  if (pageUrl) {
    columnValues[config.columns.pageUrl] = pageUrl;
  }

  if (phone) {
    columnValues[config.columns.phone] = phone;
  }

  if (lead.email) {
    columnValues[config.columns.email] = lead.email;
  }

  if (LOCATION_LABELS.has(locationLabel)) {
    columnValues[config.columns.location] = { label: locationLabel };
  }

  if (lead.generalConcern) {
    columnValues[config.columns.concern] = { text: lead.generalConcern };
  }

  if (PROVIDER_LABELS.has(providerLabel)) {
    columnValues[config.columns.provider] = { label: providerLabel };
  }

  if (STATUS_LABELS.has(statusLabel)) {
    columnValues[config.columns.status] = { label: statusLabel };
  }

  return columnValues;
}

export async function createMondayLeadItem(lead: MondayLeadInput) {
  const config = getMondayConfig();

  if (!config) {
    return { created: false, reason: "monday_not_configured" };
  }

  const query = `
    mutation CreateWendyLead($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
        id
      }
    }
  `;
  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        boardId: config.boardId,
        itemName: `Wendy Lead - ${lead.name}`,
        columnValues: JSON.stringify(buildMondayColumnValues(lead)),
      },
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    data?: { create_item?: { id?: string } };
    errors?: Array<{ message?: string }>;
  };
  const itemId = data.data?.create_item?.id;

  if (!response.ok || !itemId) {
    console.error("Wendy Monday lead creation failed:", {
      status: response.status,
      error: data.errors?.[0]?.message ?? "Unknown Monday error",
    });
    return { created: false, reason: "monday_create_failed" };
  }

  console.log("[Wendy Monday lead created]", {
    itemId,
    boardId: config.boardId,
    hasEmail: Boolean(lead.email),
    hasPhone: Boolean(lead.phone),
    preferredLocation: normalizeLocationLabel(lead.preferredLocation),
  });

  return { created: true, itemId };
}
