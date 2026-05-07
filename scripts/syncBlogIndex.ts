import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SITEMAP_INDEX_URL = "https://windyridgechiropractic.com/sitemap_index.xml";
const BLOG_INDEX_OUTPUT_PATH = path.join(
  process.cwd(),
  "data/generated/blog-index.json",
);
const BLOG_KNOWLEDGE_OUTPUT_PATH = path.join(
  process.cwd(),
  "data/generated/blog-knowledge.md",
);

type BlogArticle = {
  title: string;
  url: string;
  summary: string;
  category: string;
  tags: string[];
  relevantKeywords: string[];
  excerpt: string;
  sourceType: "blog";
  publishedAt?: string;
  modifiedAt?: string;
  headings: string[];
};

type CategoryDefinition = {
  category: string;
  keywords: string[];
};

const IGNORED_URL_PATTERNS = [
  /\.(avif|gif|jpeg|jpg|mp3|mp4|pdf|png|svg|webm|webp|zip)(\?|$)/i,
  /\/author\//i,
  /\/tag\//i,
  /\/category\//i,
  /\/wp-json/i,
  /\/wp-admin/i,
  /\/wp-login/i,
  /\/feed\//i,
  /\/page\/\d+\/?$/i,
];

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    category: "Low Back Pain",
    keywords: ["low back", "lower back", "back pain", "sciatica", "disc", "herniated", "lumbar"],
  },
  {
    category: "Neck Pain",
    keywords: ["neck pain", "neck tension", "posture", "desk", "tech neck", "whiplash"],
  },
  {
    category: "Headaches / Migraines",
    keywords: ["headache", "headaches", "migraine", "migraines", "tension headache"],
  },
  {
    category: "Dry Needling / Soft Tissue",
    keywords: ["dry needling", "soft tissue", "soreness", "aftercare", "muscle", "tight muscles", "massage"],
  },
  {
    category: "First Visit / New Patients",
    keywords: ["first visit", "new patient", "what to expect", "exam", "palpation", "neurological testing"],
  },
  {
    category: "Cost / Insurance",
    keywords: ["cost", "price", "pricing", "insurance", "cash", "rates", "covered", "benefits"],
  },
  {
    category: "Pregnancy / Postpartum",
    keywords: ["pregnancy", "pregnant", "postpartum", "prenatal", "mom", "moms"],
  },
  {
    category: "Pediatrics / Newborn",
    keywords: ["pediatric", "newborn", "baby", "infant", "child", "children", "kids"],
  },
  {
    category: "Athletes / Outdoor / Skiing",
    keywords: ["athlete", "athletes", "outdoor", "skiing", "ski", "trail running", "running", "mobility", "performance"],
  },
  {
    category: "Big Sky",
    keywords: ["big sky", "skiing", "mountain", "massage therapy big sky"],
  },
  {
    category: "Bozeman / Local Chiropractic",
    keywords: ["bozeman", "four corners", "belgrade", "gallatin", "local chiropractor"],
  },
  {
    category: "Chiropractic vs Physical Therapy",
    keywords: ["physical therapy", "physical therapist", "pt", "chiropractor vs", "rehab"],
  },
  {
    category: "Exercises / Rehab",
    keywords: ["exercise", "exercises", "rehab", "mobility", "stretch", "strength", "movement"],
  },
  {
    category: "Animal Chiropractic",
    keywords: ["animal", "dog", "cat", "pet", "veterinary", "small animal"],
  },
  {
    category: "Massage Therapy",
    keywords: ["massage", "massage therapy", "tight muscles", "recovery", "soft tissue"],
  },
  {
    category: "General Chiropractic Education",
    keywords: ["chiropractic", "chiropractor", "adjustment", "care", "wellness"],
  },
];

const TAG_KEYWORDS = [
  "dry needling",
  "soreness",
  "aftercare",
  "soft tissue",
  "low back pain",
  "back pain",
  "sciatica",
  "skiing",
  "neck pain",
  "desk work",
  "posture",
  "headaches",
  "migraines",
  "cost",
  "insurance",
  "cash pricing",
  "pregnancy",
  "postpartum",
  "pediatric",
  "newborn",
  "big sky",
  "bozeman",
  "four corners",
  "chiropractor vs pt",
  "physical therapy",
  "exercises",
  "rehab",
  "animal chiropractic",
  "massage therapy",
];

function decodeHtml(value: string) {
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
    .replace(/&#8230;/gi, "...");
}

function cleanText(value: string) {
  return decodeHtml(value)
    .replace(/\b(cookie|cookies|privacy settings|accept all|reject all)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<(br|p|div|section|article|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function getClassContent(html: string, classPattern: RegExp) {
  const matches = Array.from(
    html.matchAll(/<([a-z0-9]+)[^>]*class=["']([^"']+)["'][^>]*>/gi),
  );

  for (const match of matches) {
    const [openingTag, tagName, className] = match;

    if (!classPattern.test(className)) {
      continue;
    }

    const contentStart = (match.index ?? 0) + openingTag.length;
    const closingTag = new RegExp(`</${tagName}>`, "gi");
    closingTag.lastIndex = contentStart;
    const closingMatch = closingTag.exec(html);

    if (closingMatch) {
      return html.slice(contentStart, closingMatch.index);
    }
  }

  return "";
}

function removeArticleBoilerplate(text: string) {
  const boilerplateStarts = [
    "What Patients in Bozeman Should Know",
    "Related Posts",
    "Recent Posts",
    "Read Our Blog",
    "Explore Services",
    "Ready to book",
    "Book Appointment",
    "Schedule Online",
    "Share this post",
  ];
  let clippedText = text;

  for (const phrase of boilerplateStarts) {
    const index = clippedText.toLowerCase().indexOf(phrase.toLowerCase());

    if (index > 250) {
      clippedText = clippedText.slice(0, index);
    }
  }

  return clippedText
    .replace(/\b(Previous Post|Next Post|Leave a Reply|Comments are closed)\b.*$/gi, " ")
    .trim();
}

function extractLocs(xml: string) {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi), (match) =>
    decodeHtml(match[1].trim()),
  );
}

function shouldIgnoreUrl(url: string) {
  return IGNORED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function isLikelyBlogSitemap(url: string) {
  const normalizedUrl = url.toLowerCase();

  return normalizedUrl.includes("post-sitemap") || normalizedUrl.includes("blog");
}

function isLikelyArticleUrl(url: string) {
  const normalizedUrl = url.toLowerCase();

  if (shouldIgnoreUrl(url)) {
    return false;
  }

  if (normalizedUrl.includes("/chiropractic-blog/")) {
    return true;
  }

  return ![
    "/chiropractic-services/",
    "/what-to-expect",
    "/contact",
    "/about",
    "/services",
    "/locations",
  ].some((pathPart) => normalizedUrl.includes(pathPart));
}

async function fetchText(url: string) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "WindyWendyBlogIndexSync/1.0",
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

function getMetaContent(html: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match =
    html.match(
      new RegExp(`<meta[^>]+(?:name|property)=["']${escapedSelector}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    ) ??
    html.match(
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escapedSelector}["'][^>]*>`, "i"),
    );

  return match?.[1] ? cleanText(match[1]) : "";
}

function getCanonicalUrl(html: string, fallbackUrl: string) {
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];

  return canonical ? cleanText(canonical) : fallbackUrl;
}

function getTitle(html: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const ogTitle = getMetaContent(html, "og:title");
  const title = h1 ?? ogTitle ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";

  return cleanText(stripHtml(title))
    .replace(/\s+-\s+Windy Ridge Chiropractic$/i, "")
    .replace(/\s+\|\s+Windy Ridge.*$/i, "");
}

function getHeadings(html: string) {
  return Array.from(html.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi), (match) =>
    cleanText(stripHtml(match[1])),
  )
    .filter((heading) => heading.length > 0)
    .slice(0, 12);
}

function getArticleText(html: string) {
  const articleHtml =
    getClassContent(
      html,
      /\b(entry-content|post-content|wp-block-post-content|elementor-widget-theme-post-content|fl-post-content)\b/i,
    ) ||
    (html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    html);
  const text = cleanText(stripHtml(articleHtml));

  return removeArticleBoilerplate(text)
    .replace(/Share this post\s*/gi, " ")
    .replace(/Read more\s*/gi, " ")
    .slice(0, 5500)
    .trim();
}

function getDate(html: string, field: "published" | "modified") {
  const property =
    field === "published" ? "article:published_time" : "article:modified_time";
  const metaDate = getMetaContent(html, property);

  if (metaDate) {
    return metaDate;
  }

  const timeMatch = html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i)?.[1];

  return timeMatch ? cleanText(timeMatch) : undefined;
}

function scoreKeywords(text: string, keywords: string[]) {
  return keywords.reduce((score, keyword) => {
    return text.includes(keyword) ? score + (keyword.includes(" ") ? 3 : 1) : score;
  }, 0);
}

function categorizeArticle(primaryText: string, searchText: string) {
  const [bestCategory] = CATEGORY_DEFINITIONS.map((definition) => ({
    category: definition.category,
    score:
      scoreKeywords(primaryText, definition.keywords) * 4 +
      scoreKeywords(searchText, definition.keywords),
  })).sort((first, second) => second.score - first.score);

  return bestCategory?.score > 0
    ? bestCategory.category
    : "General Chiropractic Education";
}

function getTags(primaryText: string, searchText: string, category: string) {
  const primaryTags = TAG_KEYWORDS.filter((keyword) => primaryText.includes(keyword));
  const secondaryTags = TAG_KEYWORDS.filter((keyword) => {
    if (!searchText.includes(keyword) || primaryTags.includes(keyword)) {
      return false;
    }

    if (
      /headaches?|migraines?/.test(keyword) &&
      category !== "Headaches / Migraines"
    ) {
      return false;
    }

    if (/low back pain|back pain|sciatica/.test(keyword) && category !== "Low Back Pain") {
      return false;
    }

    if (/neck pain/.test(keyword) && category !== "Neck Pain") {
      return false;
    }

    return true;
  });
  const tags = [...primaryTags, ...secondaryTags];

  return Array.from(new Set(tags)).slice(0, 10);
}

function getRelevantKeywords(searchText: string, category: string, tags: string[]) {
  const categoryKeywords =
    CATEGORY_DEFINITIONS.find((definition) => definition.category === category)?.keywords ??
    [];

  return Array.from(
    new Set([...tags, ...categoryKeywords.filter((keyword) => searchText.includes(keyword))]),
  ).slice(0, 14);
}

function getExcerpt(text: string) {
  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .find((value) => value.length >= 60);

  if (!sentence) {
    return text.slice(0, 220).trim();
  }

  return sentence.length > 240 ? `${sentence.slice(0, 237).trim()}...` : sentence;
}

async function getBlogUrls() {
  const sitemapIndex = await fetchText(SITEMAP_INDEX_URL);
  const childSitemaps = extractLocs(sitemapIndex).filter(isLikelyBlogSitemap);
  const urlGroups = await Promise.all(
    childSitemaps.map(async (sitemapUrl) => {
      const sitemap = await fetchText(sitemapUrl);

      return extractLocs(sitemap);
    }),
  );
  const urls = Array.from(new Set(urlGroups.flat().filter(isLikelyArticleUrl))).sort();

  if (process.env.NODE_ENV !== "production") {
    console.log("[Wendy blog sync] Blog URLs found:", urls.length);
  }

  return urls;
}

async function fetchArticle(url: string): Promise<BlogArticle | null> {
  try {
    const html = await fetchText(url);
    const title = getTitle(html);
    const canonicalUrl = getCanonicalUrl(html, url);
    const metaDescription =
      getMetaContent(html, "description") || getMetaContent(html, "og:description");
    const headings = getHeadings(html);
    const articleText = getArticleText(html);

    if (!title || articleText.length < 180) {
      return null;
    }

    const primaryText = cleanText(`${title} ${canonicalUrl} ${metaDescription}`).toLowerCase();
    const searchText = cleanText(
      `${primaryText} ${headings.join(" ")} ${articleText.slice(0, 2200)}`,
    ).toLowerCase();
    const category = categorizeArticle(primaryText, searchText);
    const tags = getTags(primaryText, searchText, category);

    return {
      title,
      url: canonicalUrl,
      summary: metaDescription || getExcerpt(articleText),
      category,
      tags,
      relevantKeywords: getRelevantKeywords(searchText, category, tags),
      excerpt: getExcerpt(articleText),
      sourceType: "blog",
      publishedAt: getDate(html, "published"),
      modifiedAt: getDate(html, "modified"),
      headings,
    };
  } catch (error) {
    console.warn(`Skipping blog article ${url}`, error);
    return null;
  }
}

function formatBlogKnowledge(articles: BlogArticle[]) {
  const generatedAt = new Date().toISOString();
  const body = articles
    .map((article) =>
      [
        `## ${article.title}`,
        `URL: ${article.url}`,
        `Source type: Blog`,
        `Category: ${article.category}`,
        `Tags: ${article.tags.join(", ") || "general chiropractic"}`,
        article.publishedAt ? `Published: ${article.publishedAt}` : "",
        article.modifiedAt ? `Modified: ${article.modifiedAt}` : "",
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
    `Generated from ${SITEMAP_INDEX_URL} at ${generatedAt}.`,
    "",
    "This file is generated by `npm run sync:blogs`. Use it as concise article knowledge and resource recommendation context.",
    "",
    body,
    "",
  ].join("\n");
}

async function main() {
  const urls = await getBlogUrls();
  const articles: BlogArticle[] = [];

  for (const url of urls) {
    const article = await fetchArticle(url);

    if (article) {
      articles.push(article);
    }

    await sleep(250);
  }

  await mkdir(path.dirname(BLOG_INDEX_OUTPUT_PATH), { recursive: true });
  await writeFile(BLOG_INDEX_OUTPUT_PATH, `${JSON.stringify(articles, null, 2)}\n`, "utf8");
  await writeFile(BLOG_KNOWLEDGE_OUTPUT_PATH, formatBlogKnowledge(articles), "utf8");

  if (process.env.NODE_ENV !== "production") {
    const categories = Array.from(new Set(articles.map((article) => article.category)));

    console.log("[Wendy blog sync] Articles indexed:", articles.length);
    console.log("[Wendy blog sync] Categories created:", categories.join(", "));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
