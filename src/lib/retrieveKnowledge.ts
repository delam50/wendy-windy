import { readFileSync } from "node:fs";
import path from "node:path";

type KnowledgeFile = {
  label: string;
  path: string;
};

type KnowledgeChunk = {
  title: string;
  source: string;
  url?: string;
  text: string;
};

export type RetrievedResource = {
  title: string;
  summary: string;
  url: string;
  type: string;
  score: number;
};

type ScoredKnowledgeChunk = KnowledgeChunk & {
  score: number;
  resourceScore: number;
  isPrimaryResource?: boolean;
  isAdditionalResource?: boolean;
};

type RetrievalInput = {
  query: string;
  conversationContext?: string;
  pageContext?: string;
  excludedUrls?: string[];
  wantsMoreResources?: boolean;
  includeBookingResource?: boolean;
};

const KNOWLEDGE_FILES: KnowledgeFile[] = [
  {
    label: "Generated clinic identity knowledge",
    path: path.join(process.cwd(), "data", "generated", "clinic-identity.md"),
  },
  {
    label: "Generated website knowledge",
    path: path.join(process.cwd(), "data", "generated", "website-knowledge.md"),
  },
  {
    label: "Generated Jane booking knowledge",
    path: path.join(process.cwd(), "data", "generated", "jane-knowledge.md"),
  },
  {
    label: "Generated sitemap knowledge",
    path: path.join(process.cwd(), "data", "generated", "sitemap-knowledge.md"),
  },
  {
    label: "Generated blog knowledge",
    path: path.join(process.cwd(), "data", "generated", "blog-knowledge.md"),
  },
  {
    label: "Website knowledge",
    path: path.join(process.cwd(), "data", "website-knowledge.md"),
  },
  {
    label: "Jane booking knowledge",
    path: path.join(process.cwd(), "data", "jane-knowledge.md"),
  },
  {
    label: "Blog knowledge",
    path: path.join(process.cwd(), "data", "blog-knowledge.md"),
  },
];

const PRIORITY_TERMS = [
  "pricing",
  "cost",
  "cash pricing",
  "cash price",
  "cash rate",
  "cash rates",
  "insurance",
  "first visit",
  "new patient",
  "new patient exam",
  "new patient evaluation",
  "follow-up",
  "follow up",
  "follow-up visit",
  "return visit",
  "soft tissue",
  "adjustment and soft tissue",
  "adjustment + soft tissue",
  "patient responsibility",
  "deductible",
  "deductibles",
  "copay",
  "copays",
  "bozeman",
  "four corners",
  "big sky",
  "dry needling",
  "neck pain",
  "low back pain",
  "lower back pain",
  "headaches",
  "headache",
  "migraines",
  "migraine",
  "pregnancy",
  "pregnant",
  "pediatrics",
  "pediatric",
  "booking",
  "book",
  "appointment",
  "provider",
  "providers",
  "dr.",
  "doctor",
  "kyle",
  "delamielleure",
  "joshua",
  "prange",
  "claire",
  "schauf",
  "michelle",
  "snider",
  "david",
  "dalgardno",
  "james",
  "beaudry",
  "nichole",
  "massage",
  "therapist",
  "animal",
  "animals",
  "small animal",
  "pet",
  "pets",
  "dog",
  "dogs",
  "cat",
  "cats",
  "veterinary",
  "exercises",
  "exercise",
  "chiropractor vs pt",
  "physical therapy",
  "physical therapist",
];

const CONDITION_TERMS = [
  "neck pain",
  "low back pain",
  "lower back pain",
  "back pain",
  "headache",
  "headaches",
  "migraine",
  "migraines",
  "dry needling",
  "soft tissue",
  "adjustment and soft tissue",
  "adjustment + soft tissue",
  "pregnancy",
  "pregnant",
  "pediatric",
  "pediatrics",
  "sports injury",
  "massage",
  "cupping",
  "sciatica",
  "disc",
  "posture",
  "small animal chiropractic",
  "animal chiropractic",
  "pet chiropractic",
  "dog chiropractic",
  "veterinary chiropractic",
  "animal adjustments",
  "exercises",
  "exercise",
  "chiropractor vs pt",
];

const CORNERSTONE_TERMS = [
  "first visit",
  "cost",
  "pricing",
  "cash pricing",
  "insurance",
  "four corners",
  "services",
  "chiropractic services",
  "big sky chiropractor",
  "bozeman chiropractor",
];

const RELATED_TERM_GROUPS = [
  ["desk", "desk worker", "screen", "computer", "tech neck", "posture"],
  ["ski", "skiing", "slopes", "winter", "big sky", "back pain", "neck pain"],
  ["hike", "hiking", "trail", "outdoor", "active", "mobility"],
  ["run", "runner", "trail runner", "athlete", "sports injury", "training"],
  ["headache", "migraine", "tension", "neck pain", "tmj"],
  ["low back", "lower back", "back pain", "disc", "sciatica", "sitting"],
  ["pregnancy", "pregnant", "prenatal", "webster", "pelvis"],
  ["pediatric", "child", "kids", "family", "growth"],
  [
    "cost",
    "pricing",
    "insurance",
    "cash",
    "cash pricing",
    "cash rate",
    "cash rates",
    "rate",
    "benefits",
    "deductible",
    "deductibles",
    "copay",
    "copays",
    "patient responsibility",
  ],
  ["four corners", "bozeman", "big sky", "location", "locations"],
  ["new patient exam", "new patient evaluation", "new patient", "first visit", "exam", "evaluation"],
  ["follow-up", "follow up", "follow-up visit", "return visit", "return appointment"],
  ["soft tissue", "dry needling", "adjustment and soft tissue", "adjustment + soft tissue"],
  ["first visit", "exam", "evaluation", "new patient", "what to expect"],
  ["pet", "pets", "dog", "dogs", "cat", "cats", "animal", "animals", "veterinary"],
  ["exercise", "exercises", "mobility", "stretch", "strength", "rehab"],
  ["chiropractor", "physical therapy", "physical therapist", "pt", "rehab"],
];

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "can",
  "could",
  "for",
  "from",
  "have",
  "help",
  "how",
  "into",
  "like",
  "more",
  "should",
  "that",
  "the",
  "their",
  "there",
  "this",
  "what",
  "when",
  "where",
  "with",
  "would",
  "your",
]);

const MAX_CHUNK_CHARS = 1100;
const TOP_CHUNK_COUNT = 8;
const MIN_CHUNK_COUNT = 5;

let cachedChunks: KnowledgeChunk[] | undefined;

function normalize(value: string) {
  return value.toLowerCase().replace(/&amp;/g, "&");
}

function extractKeywords(query: string) {
  return Array.from(
    new Set(
      normalize(query)
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/[^a-z0-9.'\s-]/g, " ")
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
    ),
  );
}

function extractUrl(lines: string[]) {
  const urlLine = lines.find((line) =>
    /^(URL|Booking URL|Main website|Chiropractic services|First visit):\s+/i.test(
      line,
    ),
  );

  return urlLine?.match(/https?:\/\/\S+/)?.[0];
}

function compactText(text: string) {
  return text
    .replace(/---+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLongText(text: string) {
  if (text.length <= MAX_CHUNK_CHARS) {
    return [text];
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (`${currentChunk} ${sentence}`.trim().length > MAX_CHUNK_CHARS) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      currentChunk = sentence;
      continue;
    }

    currentChunk = `${currentChunk} ${sentence}`.trim();
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function parseMarkdownIntoChunks(markdown: string, source: string) {
  const chunks: KnowledgeChunk[] = [];
  const lines = markdown.split(/\r?\n/);
  let currentTitle = source;
  let currentLines: string[] = [];
  let inheritedUrl: string | undefined;

  function flushSection() {
    const sectionText = currentLines.join("\n").trim();

    if (!sectionText) {
      return;
    }

    const sectionLines = sectionText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const sectionUrl = extractUrl(sectionLines);
    const url = sectionUrl ?? inheritedUrl;

    if (sectionUrl) {
      inheritedUrl = sectionUrl;
    }
    const text = compactText(`${currentTitle}\n${sectionText}`);

    for (const textChunk of splitLongText(text)) {
      chunks.push({
        title: currentTitle,
        source,
        url,
        text: textChunk,
      });
    }
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);

    if (heading) {
      flushSection();
      currentTitle = heading[2].trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  flushSection();

  return chunks;
}

function loadKnowledgeChunks() {
  if (cachedChunks) {
    return cachedChunks;
  }

  cachedChunks = KNOWLEDGE_FILES.flatMap((file) => {
    try {
      return parseMarkdownIntoChunks(readFileSync(file.path, "utf8"), file.label);
    } catch {
      return [];
    }
  });

  return cachedChunks;
}

function countMatches(text: string, keywords: string[], weight: number) {
  return keywords.reduce((score, keyword) => {
    if (!keyword || !text.includes(keyword)) {
      return score;
    }

    return score + weight;
  }, 0);
}

function scoreChunk(
  chunk: KnowledgeChunk,
  input: Required<RetrievalInput>,
  queryKeywords: string[],
  contextKeywords: string[],
  pageKeywords: string[],
) {
  const normalizedQuery = normalize(input.query);
  const normalizedConversationContext = normalize(input.conversationContext);
  const normalizedPageContext = normalize(input.pageContext);
  const normalizedText = normalize(`${chunk.title} ${chunk.text} ${chunk.url ?? ""}`);
  const normalizedTitle = normalize(chunk.title);
  let score = 0;

  for (const term of PRIORITY_TERMS) {
    if (normalizedQuery.includes(term) && normalizedText.includes(term)) {
      score += term.includes(" ") ? 24 : 14;
    }

    if (
      normalizedConversationContext.includes(term) &&
      normalizedText.includes(term)
    ) {
      score += term.includes(" ") ? 10 : 6;
    }

    if (normalizedPageContext.includes(term) && normalizedText.includes(term)) {
      score += term.includes(" ") ? 16 : 9;
    }
  }

  score += countMatches(normalizedText, queryKeywords, 4);
  score += countMatches(normalizedText, contextKeywords, 2);
  score += countMatches(normalizedText, pageKeywords, 3);
  score += countMatches(normalizedTitle, queryKeywords, 6);
  score += countMatches(normalizedTitle, contextKeywords, 3);
  score += countMatches(normalizedTitle, pageKeywords, 5);

  if (
    chunk.url &&
    [...queryKeywords, ...pageKeywords].some((keyword) =>
      chunk.url?.toLowerCase().includes(keyword),
    )
  ) {
    score += 8;
  }

  if (/jane booking/i.test(chunk.source)) {
    if (/pricing|cost|insurance|price|cash|rate|\$|book|booking|appointment/i.test(normalizedQuery)) {
      score += 12;
    }
  }

  if (/pricing|cost|insurance|\$|price/i.test(chunk.text)) {
    if (/pricing|cost|insurance|price|cash|rate/i.test(normalizedQuery)) {
      score += 12;
    }
  }

  if (/pricing|cost|cash|rate|how much|\$/i.test(normalizedQuery)) {
    if (/cash pricing by location|four corners|bozeman|big sky/i.test(normalizedText)) {
      score += 18;
    }

    if (/new patient exam|follow-up|follow up|soft tissue|dry needling|adjustment \+ soft tissue|adjustment and soft tissue/i.test(normalizedQuery)) {
      score += /new patient exam|follow-up|follow up|soft tissue|dry needling|adjustment \+ soft tissue|adjustment and soft tissue/i.test(
        normalizedText,
      )
        ? 20
        : 0;
    }
  }

  if (/booking url|online bookable|providers?:/i.test(chunk.text)) {
    if (/book|booking|appointment|provider|doctor|dr\.?/i.test(normalizedQuery)) {
      score += 12;
    }
  }

  return score;
}

function isResourceCandidate(chunk: KnowledgeChunk) {
  if (!chunk.url) {
    return false;
  }

  return /sitemap|blog|website/i.test(chunk.source);
}

function scoreResourceCandidate(
  chunk: KnowledgeChunk,
  input: Required<RetrievalInput>,
  queryKeywords: string[],
  pageKeywords: string[],
) {
  if (!isResourceCandidate(chunk)) {
    return 0;
  }

  const normalizedQuery = normalize(input.query);
  const normalizedPageContext = normalize(input.pageContext);
  const normalizedTitle = normalize(chunk.title);
  const normalizedUrl = normalize(chunk.url ?? "");
  const normalizedText = normalize(chunk.text);
  const resourceText = `${normalizedTitle} ${normalizedUrl} ${normalizedText}`;
  let score = 0;

  for (const term of CONDITION_TERMS) {
    if (normalizedQuery.includes(term) && resourceText.includes(term)) {
      score += normalizedTitle.includes(term) || normalizedUrl.includes(term)
        ? 30
        : 16;
    }
  }

  for (const term of CORNERSTONE_TERMS) {
    if (
      (normalizedQuery.includes(term) || normalizedPageContext.includes(term)) &&
      resourceText.includes(term)
    ) {
      score += normalizedTitle.includes(term) || normalizedUrl.includes(term)
        ? 18
        : 10;
    }
  }

  for (const group of RELATED_TERM_GROUPS) {
    const queryHasRelatedTerm = group.some(
      (term) =>
        normalizedQuery.includes(term) || normalizedPageContext.includes(term),
    );
    const resourceHasRelatedTerm = group.some((term) => resourceText.includes(term));

    if (queryHasRelatedTerm && resourceHasRelatedTerm) {
      score += 10;
    }
  }

  if (/bozeman|big sky|four corners/.test(normalizedQuery)) {
    if (/bozeman|big sky|four corners/.test(resourceText)) {
      score += 12;
    }
  }

  if (/bozeman|big sky|four corners/.test(normalizedPageContext)) {
    if (/bozeman|big sky|four corners/.test(resourceText)) {
      score += 10;
    }
  }

  if (/\/chiropractic-services\//.test(normalizedUrl)) {
    score += 12;
  }

  if (/\/chiropractic-services\/?$/.test(normalizedUrl)) {
    score += 14;
  }

  if (/first|cost|insurance|services|big-sky|bozeman/.test(normalizedUrl)) {
    score += 8;
  }

  score += countMatches(resourceText, queryKeywords, 3);
  score += countMatches(resourceText, pageKeywords, 2);

  return score;
}

function normalizeRetrievalInput(input: string | RetrievalInput): Required<RetrievalInput> {
  if (typeof input === "string") {
    return {
      query: input,
      conversationContext: "",
      pageContext: "",
      excludedUrls: [],
      wantsMoreResources: false,
      includeBookingResource: false,
    };
  }

  return {
    query: input.query,
    conversationContext: input.conversationContext ?? "",
    pageContext: input.pageContext ?? "",
    excludedUrls: input.excludedUrls ?? [],
    wantsMoreResources: Boolean(input.wantsMoreResources),
    includeBookingResource: Boolean(input.includeBookingResource),
  };
}

function getResourceType(chunk: KnowledgeChunk) {
  const url = chunk.url?.toLowerCase() ?? "";
  const source = chunk.source.toLowerCase();

  if (url.includes("janeapp.com")) {
    return "Booking Page";
  }

  if (url.includes("first-visit") || /first visit/i.test(chunk.title)) {
    return "First Visit Guide";
  }

  if (url.includes("cost") || url.includes("insurance")) {
    return "Cost & Insurance Page";
  }

  if (url.includes("big-sky") || url.includes("bozeman") || url.includes("four-corners")) {
    return "Location Page";
  }

  if (url.includes("/chiropractic-services/") || /service/i.test(chunk.title)) {
    return "Service Page";
  }

  if (/blog/.test(source) || !url.includes("/chiropractic-services/")) {
    return "Blog";
  }

  return "Resource";
}

function getResourceSummary(chunk: KnowledgeChunk) {
  const text = chunk.text
    .replace(/https?:\/\/\S+/g, "")
    .replace(chunk.title, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .find((value) => value.length >= 40);

  if (sentence) {
    return sentence.length > 160 ? `${sentence.slice(0, 157).trim()}...` : sentence;
  }

  return "A Windy Ridge resource with more detail on this topic.";
}

function isJaneBookingChunk(chunk: KnowledgeChunk) {
  return Boolean(chunk.url?.includes("windyridgechiropractic.janeapp.com"));
}

export function retrieveResources(
  input: string | RetrievalInput,
  maxResources?: number,
): RetrievedResource[] {
  const retrievalInput = normalizeRetrievalInput(input);
  const queryKeywords = extractKeywords(retrievalInput.query);
  const pageKeywords = extractKeywords(retrievalInput.pageContext);
  const excludedUrls = new Set(
    retrievalInput.excludedUrls.map((url) => url.toLowerCase()),
  );
  const limit = maxResources ?? (retrievalInput.wantsMoreResources ? 4 : 1);
  const fallbackMinimumScore = retrievalInput.wantsMoreResources ? 8 : 12;
  const seenUrls = new Set<string>();

  const resources = loadKnowledgeChunks()
    .filter((chunk) => chunk.url)
    .filter((chunk) => {
      const url = chunk.url?.toLowerCase() ?? "";

      if (excludedUrls.has(url)) {
        return false;
      }

      if (isJaneBookingChunk(chunk) && !retrievalInput.includeBookingResource) {
        return false;
      }

      return isResourceCandidate(chunk) || isJaneBookingChunk(chunk);
    })
    .map((chunk) => {
      const resourceScore =
        scoreResourceCandidate(chunk, retrievalInput, queryKeywords, pageKeywords) +
        (isJaneBookingChunk(chunk) ? 8 : 0);

      return {
        chunk,
        score: resourceScore || scoreChunk(chunk, retrievalInput, queryKeywords, [], pageKeywords),
      };
    })
    .filter(({ score }) => score >= fallbackMinimumScore)
    .sort((a, b) => b.score - a.score)
    .filter(({ chunk }) => {
      const url = chunk.url?.toLowerCase();

      if (!url || seenUrls.has(url)) {
        return false;
      }

      seenUrls.add(url);
      return true;
    })
    .slice(0, limit)
    .map<RetrievedResource>(({ chunk, score }) => ({
      title: chunk.title,
      summary: getResourceSummary(chunk),
      url: chunk.url ?? "",
      type: getResourceType(chunk),
      score,
    }));

  if (resources.length > 0 || retrievalInput.includeBookingResource) {
    return resources;
  }

  return loadKnowledgeChunks()
    .filter((chunk) => chunk.url && !excludedUrls.has(chunk.url.toLowerCase()))
    .filter((chunk) => isResourceCandidate(chunk))
    .sort((a, b) => {
      const aType = getResourceType(a);
      const bType = getResourceType(b);
      const typeWeight = (type: string) =>
        type === "First Visit Guide" ? 4 : type === "Service Page" ? 3 : type === "Blog" ? 2 : 1;

      return typeWeight(bType) - typeWeight(aType);
    })
    .slice(0, limit)
    .map((chunk) => ({
      title: chunk.title,
      summary: getResourceSummary(chunk),
      url: chunk.url ?? "",
      type: getResourceType(chunk),
      score: 0,
    }));
}

export function retrieveKnowledge(
  input: string | RetrievalInput,
  maxChunks = TOP_CHUNK_COUNT,
) {
  const retrievalInput = normalizeRetrievalInput(input);
  const trimmedQuery = [
    retrievalInput.query,
    retrievalInput.conversationContext,
    retrievalInput.pageContext,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!trimmedQuery) {
    return "";
  }

  const queryKeywords = extractKeywords(retrievalInput.query);
  const contextKeywords = extractKeywords(retrievalInput.conversationContext);
  const pageKeywords = extractKeywords(retrievalInput.pageContext);
  const selectedChunkCount = Math.min(
    TOP_CHUNK_COUNT,
    Math.max(MIN_CHUNK_COUNT, maxChunks),
  );
  const seenChunkKeys = new Set<string>();
  const excludedUrls = new Set(
    retrievalInput.excludedUrls.map((url) => url.toLowerCase()),
  );
  const scoredChunks = loadKnowledgeChunks()
    .map<ScoredKnowledgeChunk>((chunk) => {
      const resourceScore = scoreResourceCandidate(
        chunk,
        retrievalInput,
        queryKeywords,
        pageKeywords,
      );

      return {
        ...chunk,
        resourceScore,
        score:
          scoreChunk(
            chunk,
            retrievalInput,
            queryKeywords,
            contextKeywords,
            pageKeywords,
          ) + Math.min(resourceScore, 30),
      };
    })
    .filter((chunk) => chunk.score > 0)
    .filter(
      (chunk) =>
        !chunk.url || !excludedUrls.has(chunk.url.toLowerCase()),
    )
    .sort((a, b) => b.score - a.score)
    .filter((chunk) => {
      const key = `${chunk.url ?? chunk.source}:${chunk.title}:${chunk.text.slice(0, 80)}`;

      if (seenChunkKeys.has(key)) {
        return false;
      }

      seenChunkKeys.add(key);
      return true;
    })
    .slice(0, selectedChunkCount);

  const resourceCandidates = scoredChunks
    .filter((chunk) => chunk.resourceScore >= 24)
    .sort((a, b) => b.resourceScore - a.resourceScore);
  const primaryResource = resourceCandidates[0];

  if (primaryResource) {
    primaryResource.isPrimaryResource = true;
  }

  if (retrievalInput.wantsMoreResources) {
    resourceCandidates.slice(1, 4).forEach((chunk) => {
      chunk.isAdditionalResource = true;
    });
  }

  if (scoredChunks.length === 0) {
    return "";
  }

  return scoredChunks
    .map((chunk, index) => {
      const sourceUrl = chunk.url ? `\nSource URL: ${chunk.url}` : "";
      const resourceNote = chunk.isPrimaryResource
        ? "\nResource note: Primary related article or service page. If useful, recommend only this one resource naturally after answering."
        : chunk.isAdditionalResource
          ? "\nResource note: Additional relevant resource option. Only include this if the user explicitly asked for more blogs, more resources, more articles, or additional reading."
        : "";

      return `Relevant knowledge chunk ${index + 1}
Source: ${chunk.source}
Title: ${chunk.title}${sourceUrl}${resourceNote}
Content: ${chunk.text}`;
    })
    .join("\n\n---\n\n");
}
