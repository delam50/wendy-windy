import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  clinicKnowledge,
  type ClinicKnowledgeChunkType,
  type ClinicKnowledgeSourceType,
} from "../src/lib/clinicKnowledge";

type BlogArticleInput = {
  title: string;
  url: string;
  canonical_url?: string;
  canonicalUrl?: string;
  slug?: string;
  summary?: string;
  category?: string;
  tags?: string[];
  relevantKeywords?: string[];
  keywords?: string[];
  excerpt?: string;
  sourceType?: string;
  source_type?: string;
  publishedAt?: string;
  published_at?: string;
  modifiedAt?: string;
  modified_at?: string;
  headings?: string[];
  searchable_text?: string;
};

type CanonicalBlogArticle = {
  title: string;
  url: string;
  canonical_url: string;
  slug: string;
  source_type: "blog";
  category: string;
  tags: string[];
  summary: string;
  excerpt: string;
  headings: string[];
  published_at?: string;
  modified_at?: string;
  keywords: string[];
  relevantKeywords: string[];
  searchable_text: string;
};

type KnowledgeIndexChunk = {
  id: string;
  source_type: ClinicKnowledgeSourceType;
  chunk_type: ClinicKnowledgeChunkType;
  title: string;
  url?: string;
  category: string;
  tags: string[];
  priority: number;
  text: string;
  searchable_text: string;
  metadata: Record<string, unknown>;
  canonical_source: string;
  embedding_text: string;
  embedding_model: string | null;
  embedding_updated_at: string | null;
  vector_id: string | null;
};

const generatedDir = path.join(process.cwd(), "data", "generated");
const blogIndexPath = path.join(generatedDir, "blog-index.json");
const blogKnowledgePath = path.join(generatedDir, "blog-knowledge.md");
const clinicKnowledgePath = path.join(generatedDir, "clinic-knowledge.json");
const knowledgeManifestPath = path.join(generatedDir, "knowledge-manifest.json");
const knowledgeIndexPath = path.join(generatedDir, "knowledge-index.json");

const generatedKnowledgeSources = [
  {
    sourceId: "clinic-knowledge",
    sourceType: "clinic_fact" as const,
    filePath: "data/generated/clinic-knowledge.json",
    priority: 110,
    canonical: true,
    usedByRetrieval: true,
    freshness: "canonical structured facts",
  },
  {
    sourceId: "blog-index",
    sourceType: "blog" as const,
    filePath: "data/generated/blog-index.json",
    priority: 70,
    canonical: true,
    usedByRetrieval: true,
    freshness: "generated from sitemap by npm run sync:blogs",
  },
  {
    sourceId: "generated-jane-knowledge",
    sourceType: "booking" as const,
    filePath: "data/generated/jane-knowledge.md",
    priority: 90,
    canonical: true,
    usedByRetrieval: true,
    freshness: "generated from public JaneApp pages",
  },
  {
    sourceId: "generated-website-knowledge",
    sourceType: "service" as const,
    filePath: "data/generated/website-knowledge.md",
    priority: 55,
    canonical: false,
    usedByRetrieval: true,
    freshness: "supplemental manual/static website knowledge",
  },
  {
    sourceId: "generated-sitemap-knowledge",
    sourceType: "service" as const,
    filePath: "data/generated/sitemap-knowledge.md",
    priority: 50,
    canonical: false,
    usedByRetrieval: true,
    freshness: "generated sitemap supplement; structured facts outrank this",
  },
  {
    sourceId: "generated-blog-knowledge",
    sourceType: "blog" as const,
    filePath: "data/generated/blog-knowledge.md",
    priority: 45,
    canonical: false,
    usedByRetrieval: false,
    freshness: "generated from blog-index.json for human review and fallback documentation",
  },
  {
    sourceId: "legacy-blog-knowledge",
    sourceType: "blog" as const,
    filePath: "data/blog-knowledge.md",
    priority: 10,
    canonical: false,
    usedByRetrieval: false,
    freshness: "legacy static summary; intentionally not active retrieval",
  },
  {
    sourceId: "legacy-jane-knowledge",
    sourceType: "booking" as const,
    filePath: "data/jane-knowledge.md",
    priority: 10,
    canonical: false,
    usedByRetrieval: false,
    freshness: "legacy manual fallback; intentionally not active retrieval",
  },
  {
    sourceId: "legacy-website-knowledge",
    sourceType: "service" as const,
    filePath: "data/website-knowledge.md",
    priority: 10,
    canonical: false,
    usedByRetrieval: false,
    freshness: "legacy manual fallback; intentionally not active retrieval",
  },
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/&#038;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getSlug(url: string) {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return url.split("/").filter(Boolean).at(-1) ?? "";
  }
}

function compactText(value: string) {
  return value
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_`>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

async function readTextIfExists(filePath: string) {
  if (!existsSync(filePath)) {
    return "";
  }

  return readFile(filePath, "utf8");
}

async function readJsonIfExists<T>(filePath: string, fallback: T): Promise<T> {
  const text = await readTextIfExists(filePath);

  if (!text) {
    return fallback;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function normalizeBlogArticle(article: BlogArticleInput): CanonicalBlogArticle {
  const canonicalUrl = article.canonical_url ?? article.canonicalUrl ?? article.url;
  const slug = article.slug ?? getSlug(canonicalUrl);
  const tags = Array.from(new Set(article.tags ?? [])).filter(Boolean);
  const keywords = Array.from(
    new Set([...(article.keywords ?? []), ...(article.relevantKeywords ?? []), ...tags]),
  ).filter(Boolean);
  const headings = Array.from(new Set(article.headings ?? [])).filter(Boolean);
  const category = article.category || "General Chiropractic Education";
  const summary =
    article.summary ||
    article.excerpt ||
    "A Windy Ridge article with practical detail on this topic.";
  const excerpt = article.excerpt || summary;
  const searchableText = compactText(
    [
      article.searchable_text,
      article.title,
      canonicalUrl,
      slug.replace(/[-_]+/g, " "),
      category,
      tags.join(" "),
      keywords.join(" "),
      headings.join(" "),
      summary,
      excerpt,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return {
    title: article.title,
    url: article.url,
    canonical_url: canonicalUrl,
    slug,
    source_type: "blog",
    category,
    tags,
    summary,
    excerpt,
    headings,
    published_at: article.published_at ?? article.publishedAt,
    modified_at: article.modified_at ?? article.modifiedAt,
    keywords,
    relevantKeywords: keywords,
    searchable_text: searchableText,
  };
}

function formatBlogKnowledge(articles: CanonicalBlogArticle[]) {
  const generatedAt = new Date().toISOString();
  const body = articles
    .map((article) =>
      [
        `## ${article.title}`,
        `URL: ${article.canonical_url}`,
        `Canonical URL: ${article.canonical_url}`,
        `Slug: ${article.slug}`,
        `Source type: Blog`,
        `Category: ${article.category}`,
        `Tags: ${article.tags.join(", ") || "general chiropractic"}`,
        `Keywords: ${article.keywords.join(", ") || "general chiropractic"}`,
        article.published_at ? `Published: ${article.published_at}` : "",
        article.modified_at ? `Modified: ${article.modified_at}` : "",
        "",
        article.summary,
        "",
        article.excerpt,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  return [
    "# Windy Ridge Chiropractic Blog Knowledge",
    "",
    `Generated from data/generated/blog-index.json at ${generatedAt}.`,
    "",
    "Canonical resource cards should use `data/generated/blog-index.json`; this Markdown file is generated documentation/fallback context.",
    "",
    body,
    "",
  ].join("\n");
}

function splitMarkdownSections(markdown: string, fallbackTitle: string) {
  const sections: Array<{ title: string; text: string; url?: string }> = [];
  const lines = markdown.split(/\r?\n/);
  let title = fallbackTitle;
  let currentLines: string[] = [];

  function flush() {
    const text = currentLines.join("\n").trim();

    if (!text) {
      return;
    }

    sections.push({
      title,
      text: compactText(`${title}\n${text}`).slice(0, 1800),
      url: text.match(/https?:\/\/\S+/)?.[0],
    });
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/);

    if (heading) {
      flush();
      title = heading[2].trim();
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return sections;
}

function makeEmbeddingText(chunk: Pick<KnowledgeIndexChunk, "title" | "category" | "tags" | "text">) {
  return compactText(
    [
      `Title: ${chunk.title}`,
      `Category: ${chunk.category}`,
      `Tags: ${chunk.tags.join(", ")}`,
      chunk.text,
    ].join("\n"),
  );
}

function toKnowledgeChunk(input: Omit<KnowledgeIndexChunk, "searchable_text" | "embedding_text" | "embedding_model" | "embedding_updated_at" | "vector_id">): KnowledgeIndexChunk {
  const searchableText = compactText(
    [input.title, input.url, input.category, input.tags.join(" "), input.text]
      .filter(Boolean)
      .join(" "),
  );

  return {
    ...input,
    searchable_text: searchableText,
    embedding_text: makeEmbeddingText({
      title: input.title,
      category: input.category,
      tags: input.tags,
      text: input.text,
    }),
    embedding_model: null,
    embedding_updated_at: null,
    vector_id: null,
  };
}

async function getManifestEntry(source: (typeof generatedKnowledgeSources)[number]) {
  const absolutePath = path.join(process.cwd(), source.filePath);
  const fileStat = existsSync(absolutePath) ? await stat(absolutePath) : undefined;

  return {
    source_id: source.sourceId,
    source_type: source.sourceType,
    file_path: source.filePath,
    generated_at: fileStat?.mtime.toISOString() ?? null,
    priority: source.priority,
    freshness: source.freshness,
    canonical: source.canonical,
    used_by_retrieval: source.usedByRetrieval && Boolean(fileStat),
    exists: Boolean(fileStat),
    bytes: fileStat?.size ?? 0,
  };
}

async function main() {
  await mkdir(generatedDir, { recursive: true });

  const rawBlogArticles = await readJsonIfExists<BlogArticleInput[]>(blogIndexPath, []);
  const blogArticles = rawBlogArticles
    .filter((article) => article.title && article.url)
    .map(normalizeBlogArticle);

  await writeFile(blogIndexPath, `${JSON.stringify(blogArticles, null, 2)}\n`, "utf8");
  await writeFile(blogKnowledgePath, formatBlogKnowledge(blogArticles), "utf8");
  await writeFile(
    clinicKnowledgePath,
    `${JSON.stringify({ ...clinicKnowledge, generatedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );

  const manifest = {
    generated_at: new Date().toISOString(),
    architecture: "canonical-wendy-knowledge-v1",
    notes: [
      "Structured clinic facts, provider routing, pricing, hours, safety, booking, massage, and animal chiropractic outrank blog/resource content.",
      "data/generated/blog-index.json is the canonical blog/resource-card source.",
      "Legacy data/*.md files are preserved for audit/documentation and are not active retrieval sources.",
    ],
    sources: await Promise.all(generatedKnowledgeSources.map(getManifestEntry)),
  };

  await writeFile(knowledgeManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const chunks: KnowledgeIndexChunk[] = [
    ...clinicKnowledge.facts.map((fact) =>
      toKnowledgeChunk({
        id: fact.id,
        source_type: fact.sourceType,
        chunk_type: fact.chunkType,
        title: fact.title,
        category: fact.category,
        tags: fact.tags,
        priority: fact.priority,
        text: fact.text,
        metadata: fact.metadata ?? {},
        canonical_source: "data/generated/clinic-knowledge.json",
      }),
    ),
    ...blogArticles.map((article) =>
      toKnowledgeChunk({
        id: `blog-${slugify(article.slug || article.title)}`,
        source_type: "blog",
        chunk_type: "blog_article",
        title: article.title,
        url: article.canonical_url,
        category: article.category,
        tags: article.tags,
        priority: 70,
        text: compactText(
          [
            article.summary,
            article.excerpt,
            article.headings.length ? `Headings: ${article.headings.join("; ")}` : "",
          ]
            .filter(Boolean)
            .join(" "),
        ),
        metadata: {
          slug: article.slug,
          published_at: article.published_at ?? null,
          modified_at: article.modified_at ?? null,
          keywords: article.keywords,
        },
        canonical_source: "data/generated/blog-index.json",
      }),
    ),
  ];

  const supplementalSources = [
    {
      filePath: path.join(generatedDir, "jane-knowledge.md"),
      canonicalSource: "data/generated/jane-knowledge.md",
      sourceType: "booking" as const,
      chunkType: "booking_info" as const,
      priority: 88,
      category: "JaneApp Booking",
      tags: ["janeapp", "booking", "pricing", "appointment"],
    },
    {
      filePath: path.join(generatedDir, "website-knowledge.md"),
      canonicalSource: "data/generated/website-knowledge.md",
      sourceType: "service" as const,
      chunkType: "service_info" as const,
      priority: 55,
      category: "Website Knowledge",
      tags: ["website", "services", "clinic"],
    },
    {
      filePath: path.join(generatedDir, "sitemap-knowledge.md"),
      canonicalSource: "data/generated/sitemap-knowledge.md",
      sourceType: "service" as const,
      chunkType: "service_info" as const,
      priority: 50,
      category: "Sitemap Knowledge",
      tags: ["sitemap", "services", "locations"],
    },
  ];

  for (const source of supplementalSources) {
    const markdown = await readTextIfExists(source.filePath);

    if (!markdown) {
      continue;
    }

    splitMarkdownSections(markdown, source.category).forEach((section, index) => {
      chunks.push(
        toKnowledgeChunk({
          id: `${slugify(source.category)}-${index + 1}-${slugify(section.title)}`,
          source_type: source.sourceType,
          chunk_type: source.chunkType,
          title: section.title,
          url: section.url,
          category: source.category,
          tags: source.tags,
          priority: source.priority,
          text: section.text,
          metadata: {},
          canonical_source: source.canonicalSource,
        }),
      );
    });
  }

  await writeFile(
    knowledgeIndexPath,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        architecture: "canonical-wendy-knowledge-v1",
        vector_ready: true,
        embedding_plan: {
          next_step:
            "Create a Supabase pgvector table, generate OpenAI embeddings from embedding_text, store vector_id, embedding_model, and embedding_updated_at, then query semantic matches before keyword reranking.",
          suggested_embedding_model: "text-embedding-3-small or the current OpenAI small embedding model",
        },
        chunks,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log("[Wendy knowledge build] Blog articles:", blogArticles.length);
  console.log("[Wendy knowledge build] Knowledge chunks:", chunks.length);
  console.log("[Wendy knowledge build] Wrote data/generated/knowledge-index.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
