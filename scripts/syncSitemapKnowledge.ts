import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SITEMAP_INDEX_URL = "https://windyridgechiropractic.com/sitemap_index.xml";
const JANE_BASE_URL = "https://windyridgechiropractic.janeapp.com";
const OUTPUT_PATH = path.join(
  process.cwd(),
  "data/generated/sitemap-knowledge.md",
);
const JANE_OUTPUT_PATH = path.join(
  process.cwd(),
  "data/generated/jane-knowledge.md",
);
const INACTIVE_PROVIDER_PATTERN = /\b(?:dr\.?\s*)?michelle\b|\bsnider\b/i;

const PRIORITY_TERMS = [
  "chiropractic",
  "back-pain",
  "neck-pain",
  "headache",
  "migraine",
  "first-visit",
  "cost",
  "insurance",
  "bozeman",
  "big-sky",
  "services",
  "pregnancy",
  "pediatric",
  "athlete",
  "exercises",
];

const IGNORED_URL_PATTERNS = [
  /\.(avif|gif|jpeg|jpg|mp3|mp4|pdf|png|svg|webm|webp|zip)(\?|$)/i,
  /\/author\//i,
  /\/tag\//i,
  /\/category\//i,
  /\/wp-json/i,
  /\/wp-admin/i,
  /\/wp-login/i,
  /\/feed\//i,
];

type PageKnowledge = {
  url: string;
  title: string;
  priorityScore: number;
  content: string;
};

type JaneTreatment = {
  id: number;
  name: string;
  treatment_duration?: number;
  scheduled_duration?: number;
  description?: string;
  call_to_book?: boolean;
  display_duration?: boolean;
  show_price?: boolean;
  price?: number | null;
  staff_member_ids?: number[];
  discipline_id?: number;
};

type JaneDiscipline = {
  id: number;
  name: string;
  professional_title?: string;
  professional_title_plural?: string;
};

type JaneStaffMember = {
  id: number;
  full_name: string;
  professional_name?: string;
  suffix?: string | null;
  treatment_order?: number[];
  location_ids?: number[];
  disciplines?: JaneDiscipline[];
  description?: string;
};

type JaneRouterData = {
  url: string;
  locationName: string;
  locationDescription: string;
  address: string;
  bookingUrl: string;
  primaryEmail: string;
  primaryPhone: string;
  treatments: JaneTreatment[];
  disciplines: JaneDiscipline[];
  staffMembers: JaneStaffMember[];
};

function extractLocs(xml: string) {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi), (match) =>
    decodeXml(match[1].trim()),
  );
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

function shouldIgnoreUrl(url: string) {
  return IGNORED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function getPriorityScore(url: string) {
  const normalizedUrl = url.toLowerCase();

  return PRIORITY_TERMS.reduce((score, term) => {
    return normalizedUrl.includes(term) ? score + 1 : score;
  }, 0);
}

function sortUrls(urls: string[]) {
  return [...urls].sort((firstUrl, secondUrl) => {
    const priorityDelta = getPriorityScore(secondUrl) - getPriorityScore(firstUrl);

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return firstUrl.localeCompare(secondUrl);
  });
}

async function fetchText(url: string) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "WindyWendyKnowledgeSync/1.0",
      },
    });

    if (response.ok) {
      return response.text();
    }

    if (
      attempt < maxAttempts &&
      (response.status === 429 || response.status >= 500)
    ) {
      await sleep(1000 * attempt);
      continue;
    }

    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  throw new Error(`Failed to fetch ${url}`);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function getTitle(html: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";

  return cleanText(stripHtml(title))
    .replace(/\s+-\s+Windy Ridge Chiropractic$/i, "")
    .replace(/\s+\|\s+Windy Ridge$/i, "");
}

function stripHtml(html: string) {
  const mainContent =
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    html;

  return mainContent
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<(br|p|div|section|article|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function cleanText(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8211;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#8220;|&#8221;/gi, '"')
    .replace(/\b(cookie|cookies|privacy settings|accept all|reject all)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteJaneUrl(url: string) {
  return new URL(url, JANE_BASE_URL).toString();
}

function cleanPageContent(html: string) {
  const text = cleanText(stripHtml(html));
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];

  return sentences
    .map((sentence) => sentence.trim())
    .filter((sentence, index, allSentences) => {
      if (sentence.length < 35) {
        return false;
      }

      return allSentences.indexOf(sentence) === index;
    })
    .join(" ")
    .slice(0, 2500)
    .trim();
}

async function getChildSitemaps() {
  const sitemapIndex = await fetchText(SITEMAP_INDEX_URL);

  return extractLocs(sitemapIndex).filter((url) => {
    const normalizedUrl = url.toLowerCase();

    return (
      normalizedUrl.includes("post") ||
      normalizedUrl.includes("page") ||
      normalizedUrl.includes("service") ||
      normalizedUrl.includes("location")
    );
  });
}

async function getSitemapUrls(sitemapUrl: string) {
  const sitemap = await fetchText(sitemapUrl);

  return extractLocs(sitemap).filter((url) => !shouldIgnoreUrl(url));
}

async function getAllPageUrls() {
  const childSitemaps = await getChildSitemaps();
  const pageUrlGroups = await Promise.all(childSitemaps.map(getSitemapUrls));
  const uniqueUrls = new Set(pageUrlGroups.flat());

  return sortUrls(Array.from(uniqueUrls));
}

async function fetchPageKnowledge(url: string): Promise<PageKnowledge | null> {
  try {
    const html = await fetchText(url);
    const content = cleanPageContent(html);

    if (!content) {
      return null;
    }

    return {
      url,
      title: getTitle(html) || url,
      priorityScore: getPriorityScore(url),
      content,
    };
  } catch (error) {
    console.warn(`Skipping ${url}`, error);
    return null;
  }
}

function formatMarkdown(pages: PageKnowledge[]) {
  const generatedAt = new Date().toISOString();

  const body = pages
    .map((page) => {
      return [
        `## ${page.title}`,
        `URL: ${page.url}`,
        `Priority score: ${page.priorityScore}`,
        "",
        page.content,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return [
    "# Windy Ridge Chiropractic Sitemap Knowledge",
    "",
    `Generated from ${SITEMAP_INDEX_URL} at ${generatedAt}.`,
    "",
    "This file is generated by `npm run sync:sitemap`. It is intended as a simple text knowledge source now and can be chunked for RAG/vector search later.",
    "",
    body,
    "",
  ].join("\n");
}

function extractBalancedValue(source: string, label: string) {
  const labelIndex = source.indexOf(label);

  if (labelIndex < 0) {
    return "";
  }

  const valueStart = source.indexOf("[", labelIndex);

  if (valueStart < 0) {
    return "";
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = valueStart; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(valueStart, index + 1);
      }
    }
  }

  return "";
}

function parseJaneArray<T>(routerOptionsSource: string, label: string): T[] {
  const rawValue = extractBalancedValue(routerOptionsSource, label);

  if (!rawValue) {
    return [];
  }

  return JSON.parse(rawValue) as T[];
}

function getJaneRouterSource(html: string) {
  const start = html.indexOf("const routerOptions =");
  const end = html.indexOf("function initializeRouter", start);

  if (start < 0 || end < 0) {
    return "";
  }

  return html.slice(start, end);
}

function extractScriptString(source: string, label: string) {
  const match = source.match(new RegExp(`${label}:\\s*"([^"]*)"`));

  return match?.[1] ? cleanText(match[1]) : "";
}

function getJaneLocations(homepageHtml: string) {
  const sections = Array.from(
    homepageHtml.matchAll(/<section class='row row-bordered'>([\s\S]*?)<\/section>/gi),
    (match) => match[1],
  );

  return sections
    .map((section) => {
      const path = section.match(/<a href="([^"]*\/locations\/[^"]*\/book)"/i)?.[1]
        ?? section.match(/<a href='([^']*\/locations\/[^']*\/book)'/i)?.[1];
      const name = cleanText(
        stripHtml(section.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""),
      );
      const note = cleanText(
        stripHtml(section.match(/<small[^>]*>([\s\S]*?)<\/small>/i)?.[1] ?? ""),
      );
      const address = cleanText(
        stripHtml(section.match(/<a class="text-muted"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? ""),
      );

      if (!path || shouldIgnoreUrl(path)) {
        return null;
      }

      return {
        name,
        note,
        address,
        bookingUrl: absoluteJaneUrl(path),
      };
    })
    .filter(
      (location): location is {
        name: string;
        note: string;
        address: string;
        bookingUrl: string;
      } =>
        Boolean(location),
    );
}

function formatDuration(seconds?: number) {
  if (!seconds) {
    return "Duration not listed";
  }

  const minutes = Math.round(seconds / 60);

  return `${minutes} minutes`;
}

function formatPrice(treatment: JaneTreatment) {
  if (treatment.call_to_book) {
    return "Call to book; pricing may need confirmation";
  }

  if (!treatment.show_price || treatment.price == null) {
    return "Price not publicly listed";
  }

  return `$${treatment.price.toFixed(2)}`;
}

function formatProviderNames(treatment: JaneTreatment, staffMembers: JaneStaffMember[]) {
  const providerNames = staffMembers
    .filter((staffMember) => treatment.staff_member_ids?.includes(staffMember.id))
    .map((staffMember) => staffMember.professional_name || staffMember.full_name);

  return providerNames.length > 0 ? providerNames.join(", ") : "Provider not listed";
}

function formatJaneLocationKnowledge(data: JaneRouterData) {
  const disciplines = data.disciplines.map((discipline) => discipline.name).join(", ");

  const treatments = data.treatments
    .map((treatment) => {
      const description = cleanText(stripHtml(treatment.description ?? ""));

      return [
        `### ${treatment.name}`,
        `Discipline: ${
          data.disciplines.find((discipline) => discipline.id === treatment.discipline_id)
            ?.name ?? "Not listed"
        }`,
        `Duration: ${formatDuration(treatment.treatment_duration)}`,
        `Scheduled time: ${formatDuration(treatment.scheduled_duration)}`,
        `Current listed price: ${formatPrice(treatment)}`,
        `Providers: ${formatProviderNames(treatment, data.staffMembers)}`,
        `Booking type: ${treatment.call_to_book ? "Call to book" : "Online bookable"}`,
        description ? `Description: ${description}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const providers = data.staffMembers
    .map((staffMember) => {
      const disciplinesText =
        staffMember.disciplines?.map((discipline) => discipline.name).join(", ") ??
        "Not listed";
      const description = cleanText(
        stripHtml(cleanText(staffMember.description ?? "")),
      ).slice(0, 700);

      return [
        `### ${staffMember.professional_name || staffMember.full_name}`,
        staffMember.suffix ? `Credentials/suffix: ${staffMember.suffix}` : "",
        `Disciplines: ${disciplinesText}`,
        description ? `Bio summary: ${description}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    `## ${data.locationName}`,
    `Booking URL: ${data.bookingUrl}`,
    data.locationDescription ? `Location note: ${data.locationDescription}` : "",
    data.address ? `Address: ${data.address}` : "",
    data.primaryPhone ? `Phone: ${data.primaryPhone}` : "",
    data.primaryEmail ? `Email: ${data.primaryEmail}` : "",
    disciplines ? `Public disciplines: ${disciplines}` : "",
    "",
    "### Appointment Types, Durations, and Listed Prices",
    treatments,
    "",
    "### Providers",
    providers,
  ]
    .filter(Boolean)
    .join("\n");
}

async function fetchJaneLocationKnowledge(location: {
  name: string;
  note: string;
  address: string;
  bookingUrl: string;
}): Promise<JaneRouterData | null> {
  try {
    const html = await fetchText(location.bookingUrl);
    const routerSource = getJaneRouterSource(html);

    if (!routerSource) {
      return null;
    }

    const staffMembers = parseJaneArray<JaneStaffMember>(routerSource, "staff_members:");
    const inactiveStaffIds = new Set(
      staffMembers
        .filter((staffMember) =>
          INACTIVE_PROVIDER_PATTERN.test(
            `${staffMember.professional_name ?? ""} ${staffMember.full_name}`,
          ),
        )
        .map((staffMember) => staffMember.id),
    );
    const activeStaffMembers = staffMembers.filter(
      (staffMember) => !inactiveStaffIds.has(staffMember.id),
    );
    const treatments = parseJaneArray<JaneTreatment>(routerSource, "treatments:")
      .map((treatment) => ({
        ...treatment,
        staff_member_ids: treatment.staff_member_ids?.filter(
          (staffId) => !inactiveStaffIds.has(staffId),
        ),
        description: INACTIVE_PROVIDER_PATTERN.test(treatment.description ?? "")
          ? undefined
          : treatment.description,
      }))
      .filter((treatment) => (treatment.staff_member_ids?.length ?? 0) > 0);

    return {
      url: location.bookingUrl,
      locationName: location.name,
      locationDescription: location.note,
      address: location.address,
      bookingUrl: location.bookingUrl,
      primaryEmail: extractScriptString(routerSource, "primary_email"),
      primaryPhone: extractScriptString(routerSource, "primary_phone"),
      treatments,
      disciplines: parseJaneArray<JaneDiscipline>(routerSource, "disciplines:").map(
        (discipline) => ({
          id: discipline.id,
          name: discipline.name,
          professional_title: discipline.professional_title,
          professional_title_plural: discipline.professional_title_plural,
        }),
      ),
      staffMembers: activeStaffMembers,
    };
  } catch (error) {
    console.warn(`Skipping Jane location ${location.bookingUrl}`, error);
    return null;
  }
}

async function syncJaneKnowledge() {
  const homepageHtml = await fetchText(JANE_BASE_URL);
  const locations = getJaneLocations(homepageHtml);
  const locationKnowledge: JaneRouterData[] = [];

  for (const location of locations) {
    const knowledge = await fetchJaneLocationKnowledge(location);

    if (knowledge) {
      locationKnowledge.push(knowledge);
    }

    await sleep(300);
  }

  const generatedAt = new Date().toISOString();
  const body = locationKnowledge.map(formatJaneLocationKnowledge).join("\n\n---\n\n");

  const markdown = [
    "# Windy Ridge Chiropractic Jane Booking Knowledge",
    "",
    `Generated from ${JANE_BASE_URL}/ at ${generatedAt}.`,
    "",
    "This file contains public-facing Jane booking information only. Use listed prices as approximate/current listed pricing, never as a guarantee. Pricing can vary depending on services performed, provider, location, and updates in Jane. Encourage visitors to confirm details directly through Jane booking.",
    "",
    body,
    "",
  ].join("\n");

  await mkdir(path.dirname(JANE_OUTPUT_PATH), { recursive: true });
  await writeFile(JANE_OUTPUT_PATH, markdown, "utf8");

  console.log(`Synced ${locationKnowledge.length} Jane locations to ${JANE_OUTPUT_PATH}`);
}

async function main() {
  const urls = await getAllPageUrls();
  const pages: PageKnowledge[] = [];

  for (const url of urls) {
    const page = await fetchPageKnowledge(url);

    if (page) {
      pages.push(page);
    }

    await sleep(300);
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, formatMarkdown(pages), "utf8");

  console.log(`Synced ${pages.length} pages to ${OUTPUT_PATH}`);

  await syncJaneKnowledge();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
