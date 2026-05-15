import { unstable_noStore as noStore } from "next/cache";

import {
  logRetrievalBenchmarkResults,
  runRetrievalBenchmarkSuite,
  summarizeRetrievalBenchmarkResults,
} from "@/lib/retrievalBenchmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParamValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];

  return Array.isArray(value) ? value[0] : value;
}

function isAuthorized(code: string | undefined) {
  const adminCode = process.env.WENDY_ADMIN_CODE?.trim();

  return Boolean(adminCode && code?.trim() && code.trim() === adminCode);
}

function getScoreTone(score: number) {
  if (score >= 100) return "text-emerald-200";
  if (score >= 50) return "text-amber-200";
  return "text-zinc-300";
}

export default async function RetrievalTestsPage({ searchParams }: PageProps) {
  noStore();

  const resolvedSearchParams = (await searchParams) ?? {};
  const code = getParamValue(resolvedSearchParams, "code");

  if (!isAuthorized(code)) {
    return (
      <main className="min-h-screen bg-[#1f1f1f] px-5 py-10 text-white">
        <section className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-[#2a2a2a]/90 p-8 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.24em] text-[#f4ad79]">
            Wendy Admin
          </p>
          <h1 className="mt-3 text-3xl font-semibold">
            Retrieval diagnostics are admin-only
          </h1>
          <p className="mt-4 text-sm leading-6 text-[#d6d6d6]">
            Add the server-side manager code as a query parameter to run the
            retrieval benchmark suite. Example:{" "}
            <code className="rounded bg-black/30 px-2 py-1 text-[#f4ad79]">
              /admin/retrieval-tests?code=...
            </code>
          </p>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            The admin code is read from <code>process.env.WENDY_ADMIN_CODE</code>{" "}
            and is never exposed in client-side code.
          </p>
        </section>
      </main>
    );
  }

  const results = runRetrievalBenchmarkSuite();
  const summary = summarizeRetrievalBenchmarkResults(results);
  const logSummary = await logRetrievalBenchmarkResults(results);

  return (
    <main className="min-h-screen bg-[#1f1f1f] px-4 py-8 text-white sm:px-6 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <div className="rounded-3xl border border-white/10 bg-[#2a2a2a]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.42),0_0_70px_rgba(196,106,45,0.12)] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-[#f4ad79]">
                Wendy Retrieval Benchmarks
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                Admin Retrieval Diagnostic Page
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#d6d6d6]">
                Fixed test questions are run against Wendy&apos;s retrieval layer
                only, before any LLM answer generation. Each run is logged to
                Supabase when configured.
              </p>
            </div>
            <div className="rounded-2xl border border-[#c46a2d]/30 bg-black/20 px-4 py-3 text-sm text-[#d6d6d6]">
              Supabase logs: {logSummary.persisted}/{logSummary.attempted} saved
              {logSummary.skippedOrFailed ? (
                <span className="text-amber-200">
                  {" "}
                  ({logSummary.skippedOrFailed} skipped/failed)
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Total tests", summary.total],
              ["Passed", summary.passed],
              ["Failed", summary.failed],
              ["Pass percentage", `${summary.passPercentage}%`],
              ["Most common failure", summary.mostCommonFailureType],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-400">
                  {label}
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {results.map((result) => (
            <article
              key={result.id}
              className="rounded-3xl border border-white/10 bg-[#262626] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.28)] sm:p-6"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        result.passed
                          ? "bg-emerald-500/15 text-emerald-200"
                          : "bg-red-500/15 text-red-200"
                      }`}
                    >
                      {result.passed ? "PASS" : "FAIL"}
                    </span>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300">
                      {result.id}
                    </span>
                  </div>
                  <h2 className="mt-4 text-xl font-semibold leading-7">
                    {result.question}
                  </h2>
                  <p className="mt-2 text-sm text-[#d6d6d6]">
                    Expected: {result.expectedTopic}
                    {result.expectedUrlIncludes
                      ? ` • URL includes "${result.expectedUrlIncludes}"`
                      : ""}{" "}
                    • terms: {result.expectedTerms.join(", ")}
                  </p>
                </div>
                <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#d6d6d6] lg:w-[360px]">
                  <p>
                    <span className="text-zinc-400">Detected intent:</span>{" "}
                    {result.detectedIntent}
                  </p>
                  <p className="mt-2">
                    <span className="text-zinc-400">Source bucket:</span>{" "}
                    {result.sourceBucketSearched}
                  </p>
                  <p className="mt-2">
                    <span className="text-zinc-400">Failure type:</span>{" "}
                    {result.failureType}
                  </p>
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-12 bg-black/30 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  <div className="col-span-1">#</div>
                  <div className="col-span-4">Document</div>
                  <div className="col-span-2">Source</div>
                  <div className="col-span-1">Score</div>
                  <div className="col-span-4">Preview</div>
                </div>
                <div className="divide-y divide-white/10">
                  {result.retrievedResults.length ? (
                    result.retrievedResults.map((document, index) => (
                      <div
                        key={`${result.id}-${document.title}-${index}`}
                        className="grid grid-cols-1 gap-3 px-4 py-4 text-sm md:grid-cols-12"
                      >
                        <div className="text-zinc-400 md:col-span-1">
                          {index + 1}
                        </div>
                        <div className="min-w-0 md:col-span-4">
                          <div className="font-medium text-white">
                            {document.title}
                          </div>
                          {document.url ? (
                            <a
                              href={document.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 block break-words text-xs text-[#f4ad79] hover:text-[#ffd2ae]"
                            >
                              {document.url}
                            </a>
                          ) : (
                            <div className="mt-1 text-xs text-zinc-500">
                              No URL
                            </div>
                          )}
                        </div>
                        <div className="text-[#d6d6d6] md:col-span-2">
                          <div>{document.sourceType}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {document.chunkType}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {document.sourceBucket}
                          </div>
                        </div>
                        <div
                          className={`font-semibold md:col-span-1 ${getScoreTone(
                            document.score,
                          )}`}
                        >
                          {Math.round(document.score)}
                        </div>
                        <div className="text-sm leading-6 text-[#d6d6d6] md:col-span-4">
                          {document.preview}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-6 text-sm text-zinc-400">
                      No documents retrieved.
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

