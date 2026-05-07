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

type ScoredKnowledgeChunk = KnowledgeChunk & {
  score: number;
  resourceScore: number;
  isPrimaryResource?: boolean;
};

type RetrievalInput = {
  query: string;
  conversationContext?: string;
  pageContext?: string;
};

const KNOWLEDGE_FILES: KnowledgeFile[] = [
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
  "insurance",
  "first visit",
  "bozeman",
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
];

const CORNERSTONE_TERMS = [
  "first visit",
  "cost",
  "pricing",
  "insurance",
  "services",
  "chiropractic services",
  "big sky chiropractor",
  "bozeman chiropractor",
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
    };
  }

  return {
    query: input.query,
    conversationContext: input.conversationContext ?? "",
    pageContext: input.pageContext ?? "",
  };
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

  const primaryResource = scoredChunks
    .filter((chunk) => chunk.resourceScore >= 24)
    .sort((a, b) => b.resourceScore - a.resourceScore)[0];

  if (primaryResource) {
    primaryResource.isPrimaryResource = true;
  }

  if (scoredChunks.length === 0) {
    return "";
  }

  return scoredChunks
    .map((chunk, index) => {
      const sourceUrl = chunk.url ? `\nSource URL: ${chunk.url}` : "";
      const resourceNote = chunk.isPrimaryResource
        ? "\nResource note: Primary related article or service page. If useful, recommend only this one resource naturally after answering."
        : "";

      return `Relevant knowledge chunk ${index + 1}
Source: ${chunk.source}
Title: ${chunk.title}${sourceUrl}${resourceNote}
Content: ${chunk.text}`;
    })
    .join("\n\n---\n\n");
}
