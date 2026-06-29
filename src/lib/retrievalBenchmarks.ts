import {
  retrieveDiagnosticDocuments,
  retrieveResources,
  type RetrievedDiagnosticDocument,
} from "./retrieveKnowledge";
import { writeRetrievalTestRun } from "./supabaseServer";

type RetrievalTestMode =
  | "explicit_resource_request"
  | "contextual_recommendation"
  | "provider_answer"
  | "pricing_answer"
  | "clinic_fact";

export type RetrievalBenchmarkTest = {
  id: string;
  question: string;
  expectedTopic: string;
  expectedTerms: string[];
  expectedUrlIncludes?: string;
  mode: RetrievalTestMode;
};

export type RetrievalBenchmarkResult = RetrievalBenchmarkTest & {
  detectedIntent: string;
  sourceBucketSearched: string;
  retrievedResults: RetrievedDiagnosticDocument[];
  passed: boolean;
  failureType: string;
  notes: string;
};

const tests: RetrievalBenchmarkTest[] = [
  {
    id: "dry-needling-blog",
    question: "Do you have a blog about dry needling?",
    expectedTopic: "Dry Needling / Soft Tissue",
    expectedTerms: ["dry needling"],
    expectedUrlIncludes: "dry-needling",
    mode: "explicit_resource_request",
  },
  {
    id: "dry-needling-aftercare",
    question: "Any resources about dry needle soreness after treatment?",
    expectedTopic: "Dry Needling Aftercare",
    expectedTerms: ["aftercare", "dry needling", "soreness"],
    expectedUrlIncludes: "dry-needling",
    mode: "explicit_resource_request",
  },
  {
    id: "massage-resource",
    question: "Do you have articles about massage therapy?",
    expectedTopic: "Massage Therapy",
    expectedTerms: ["massage"],
    expectedUrlIncludes: "massage",
    mode: "explicit_resource_request",
  },
  {
    id: "first-visit-resource",
    question: "Show me resources about what to expect on a first visit.",
    expectedTopic: "First Visit / New Patients",
    expectedTerms: ["first visit", "new patient", "what to expect"],
    expectedUrlIncludes: "first",
    mode: "explicit_resource_request",
  },
  {
    id: "cost-resource",
    question: "Do you have anything about chiropractic cost or insurance?",
    expectedTopic: "Cost / Insurance",
    expectedTerms: ["cost", "insurance", "pricing"],
    expectedUrlIncludes: "cost",
    mode: "explicit_resource_request",
  },
  {
    id: "big-sky-hours",
    question: "What are Big Sky hours?",
    expectedTopic: "Big Sky clinic hours",
    expectedTerms: ["big sky", "dr. claire", "dr. kyle", "hours"],
    mode: "clinic_fact",
  },
  {
    id: "four-corners-pricing",
    question: "How much is a new patient exam at Four Corners?",
    expectedTopic: "Four Corners pricing",
    expectedTerms: ["four corners", "$130", "new patient exam"],
    mode: "pricing_answer",
  },
  {
    id: "big-sky-pricing",
    question: "How much is a follow-up visit in Big Sky?",
    expectedTopic: "Big Sky pricing",
    expectedTerms: ["big sky", "$85", "follow-up"],
    mode: "pricing_answer",
  },
  {
    id: "pediatric-provider",
    question: "My 5 year old has growing pains, who should I see?",
    expectedTopic: "Pediatric provider routing",
    expectedTerms: ["dr. claire", "pediatric"],
    mode: "provider_answer",
  },
  {
    id: "animal-chiropractic",
    question: "Do you offer chiropractic for dogs?",
    expectedTopic: "Small animal chiropractic",
    expectedTerms: ["dr. josh", "small animal", "four corners"],
    mode: "provider_answer",
  },
  {
    id: "red-flag-safety",
    question: "I have numbness in my groin and loss of bladder control. What should I do?",
    expectedTopic: "Safety / red flag",
    expectedTerms: ["urgent", "medical care", "loss of bowel", "loss of bladder"],
    mode: "clinic_fact",
  },
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&amp;|&#038;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function detectIntent(question: string, mode: RetrievalTestMode) {
  const text = normalize(question);
  const intents: string[] = [];

  if (mode === "explicit_resource_request" || /\b(blog|article|resource|anything about|show me)\b/.test(text)) {
    intents.push("article/resource intent");
  }

  if (/\b(cost|price|pricing|insurance|how much|\$)\b/.test(text)) {
    intents.push("pricing intent");
  }

  if (/\b(hours?|open|closed|monday|tuesday|wednesday|thursday|friday)\b/.test(text)) {
    intents.push("clinic hours intent");
  }

  if (/\b(who should|provider|doctor|dr\.?|dog|animal|pediatric|child|kid)\b/.test(text)) {
    intents.push("provider matching");
  }

  if (/\b(loss of bladder|loss of bowel|numbness in my groin|urgent|emergency|severe)\b/.test(text)) {
    intents.push("urgent/red-flag symptoms");
  }

  return intents.length ? intents.join(", ") : "educational intent";
}

function getSourceBucket(mode: RetrievalTestMode) {
  if (mode === "explicit_resource_request") return "canonical blog-index resource cards";
  if (mode === "contextual_recommendation") return "strict contextual resources";
  if (mode === "provider_answer") return "structured provider/clinic facts";
  if (mode === "pricing_answer") return "structured pricing/Jane facts";
  return "canonical knowledge-index chunks";
}

function toDiagnosticResource(resource: {
  title: string;
  summary: string;
  url: string;
  type: string;
  score: number;
}): RetrievedDiagnosticDocument {
  return {
    title: resource.title,
    url: resource.url,
    sourceType: "blog",
    chunkType: "blog_article",
    sourceBucket: resource.type,
    category: resource.type,
    tags: [],
    score: resource.score,
    preview: resource.summary,
    canonicalSource: "data/generated/blog-index.json",
  };
}

function getResultsForTest(test: RetrievalBenchmarkTest) {
  if (test.mode === "explicit_resource_request") {
    return retrieveResources(
      {
        query: test.question,
        retrievalMode: "explicit",
        wantsMoreResources: true,
        includeBookingResource: false,
      },
      5,
    ).map(toDiagnosticResource);
  }

  return retrieveDiagnosticDocuments(
    {
      query: test.question,
      retrievalMode: "contextual",
      wantsMoreResources: false,
      includeBookingResource: false,
    },
    5,
  );
}

function resultMatches(test: RetrievalBenchmarkTest, result: RetrievedDiagnosticDocument) {
  const haystack = normalize(
    [
      result.title,
      result.url,
      result.sourceType,
      result.chunkType,
      result.sourceBucket,
      result.preview,
      result.canonicalSource,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const urlMatches =
    test.expectedUrlIncludes && normalize(result.url ?? "").includes(normalize(test.expectedUrlIncludes));
  const termMatches = test.expectedTerms.some((term) =>
    haystack.includes(normalize(term)),
  );

  return Boolean(urlMatches || termMatches);
}

function getFailureType(test: RetrievalBenchmarkTest, results: RetrievedDiagnosticDocument[]) {
  if (results.length === 0) return "no_results";

  const anyMatch = results.some((result) => resultMatches(test, result));

  if (anyMatch) return "expected_match_below_top_3";

  if (test.mode === "explicit_resource_request") return "resource_match_missing";
  if (test.mode === "provider_answer") return "provider_fact_not_prioritized";
  if (test.mode === "pricing_answer") return "pricing_fact_not_prioritized";

  return "keyword_or_source_mismatch";
}

export function getRetrievalBenchmarkTests() {
  return tests;
}

export function runRetrievalBenchmarkSuite(): RetrievalBenchmarkResult[] {
  return tests.map((test) => {
    const retrievedResults = getResultsForTest(test);
    const topThree = retrievedResults.slice(0, 3);
    const passed = topThree.some((result) => resultMatches(test, result));
    const failureType = passed ? "none" : getFailureType(test, retrievedResults);

    return {
      ...test,
      detectedIntent: detectIntent(test.question, test.mode),
      sourceBucketSearched: getSourceBucket(test.mode),
      retrievedResults,
      passed,
      failureType,
      notes: passed
        ? "Expected URL fragment or keyword appeared in the top 3 retrieved results."
        : "Expected URL fragment or keyword did not appear in the top 3 retrieved results.",
    };
  });
}

export async function logRetrievalBenchmarkResults(results: RetrievalBenchmarkResult[]) {
  const writes = await Promise.all(
    results.map((result) =>
      writeRetrievalTestRun({
        testId: result.id,
        question: result.question,
        expectedTerms: result.expectedTerms,
        expectedUrlIncludes: result.expectedUrlIncludes,
        retrievedResults: result.retrievedResults,
        passed: result.passed,
        failureType: result.failureType,
        notes: result.notes,
      }),
    ),
  );

  return {
    attempted: writes.length,
    persisted: writes.filter((write) => write.persisted).length,
    skippedOrFailed: writes.filter((write) => !write.persisted).length,
  };
}

export function summarizeRetrievalBenchmarkResults(results: RetrievalBenchmarkResult[]) {
  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const failed = total - passed;
  const failureCounts = results
    .filter((result) => !result.passed)
    .reduce<Record<string, number>>((counts, result) => {
      counts[result.failureType] = (counts[result.failureType] ?? 0) + 1;
      return counts;
    }, {});
  const mostCommonFailureType =
    Object.entries(failureCounts).sort((first, second) => second[1] - first[1])[0]?.[0] ??
    "none";

  return {
    total,
    passed,
    failed,
    passPercentage: total ? Math.round((passed / total) * 100) : 0,
    mostCommonFailureType,
  };
}
