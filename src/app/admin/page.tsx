"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";

const SESSION_KEY = "wendy_manager_session_code";

type HealthItem = { configured: boolean; healthy: boolean; label?: string; note?: string; count?: number };
type ConversationSummary = {
  id: string;
  updatedAt: string;
  pageTitle?: string;
  pageUrl?: string;
  inferredTopic?: string;
  detectedIntent?: string;
  leadSubmitted: boolean;
  resourceCount: number;
  bookingClicked: boolean;
  excerpt: string;
};
type KnowledgeSource = {
  source_id?: string;
  source_type?: string;
  file_path?: string;
  priority?: number;
  canonical?: boolean;
  used_by_retrieval?: boolean;
  exists?: boolean;
};
type LeadSummary = {
  id: string;
  createdAt: string;
  displayName: string;
  preferredLocation?: string;
  suggestedProvider?: string;
  leadSubmitted: boolean;
  mondayItemId?: string;
  mondayPushStatus: string;
};
type Overview = {
  generatedAt: string;
  system: {
    app: HealthItem;
    clinicTime: { dayOfWeek: string; date: string; localTime: string; timeOfDay: string; timeZone: string };
    supabase: HealthItem;
    openai: HealthItem;
    monday: HealthItem;
    blogIndex: HealthItem;
    knowledgeManifest: HealthItem;
    providerDirectory: HealthItem;
    recentFunctions: Array<{ name: string; healthy: boolean }>;
  };
  analytics: {
    funnel: Record<string, number>;
    topTopics: Array<{ topic: string; count: number }>;
    topPages: Array<{ pageTitle?: string; pageUrl?: string; count: number }>;
    topClickedResources: Array<{ title?: string; url?: string; count: number }>;
    leadCount: number;
    totalEvents: number;
  };
  conversations: { available: boolean; conversations: ConversationSummary[] };
  knowledge: {
    manifestExists: boolean;
    architecture?: string;
    generatedAt?: string | null;
    sources: KnowledgeSource[];
    activeSources: KnowledgeSource[];
    canonicalBlogFile: string;
    canonicalClinicFile: string;
    blogIndexCount: number;
    knowledgeIndexChunkCount: number;
    providerCount: number;
    pricingKnowledgeHealthy: boolean;
    hoursKnowledgeHealthy: boolean;
    staleProviderReferenceCount: number;
    staleProviderWarnings: string[];
    duplicateWarnings: string[];
  };
  leads: { available: boolean; leads: LeadSummary[] };
};
type ConversationDetail = {
  available: boolean;
  found: boolean;
  conversation: { id: string; pageTitle?: string; pageUrl?: string; inferredTopic?: string; detectedIntent?: string } | null;
  messages: Array<{ id: string; createdAt: string; role: "user" | "assistant"; content: string; redacted: boolean }>;
};
type RagResult = {
  query: string;
  detectedIntent: string;
  retrievalMode: string;
  sourcesSearched: Array<{ file?: string; sourceType?: string; canonical: boolean }>;
  rankedMatches: Array<{
    title: string;
    url?: string;
    sourceType: string;
    category: string;
    tags: string[];
    score: number;
    status: string;
    reason: string;
  }>;
  resourceCandidates: Array<{
    title: string;
    url: string;
    category: string;
    tags: string[];
    score: number;
    status: string;
    decisionReason: string;
  }>;
  fallbackUsed: boolean;
  finalResources: Array<{ title: string; url: string; type: string; score: number }>;
};
type ProviderResult = {
  query: string;
  detectedLocation: string;
  detectedCategory: string;
  rankedProviders: Array<{
    id: string;
    name: string;
    role: string;
    locations: string[];
    availability?: string;
    focus: string[];
    score: number;
    reasons: string[];
  }>;
  recommendationRules: string[];
};

async function managerRequest<T>(code: string, payload: Record<string, unknown>) {
  const response = await fetch("/api/admin/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, ...payload }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: string;
  };
  if (!response.ok || !body.ok || body.data === undefined) {
    throw new Error(body.error || "Dashboard request failed.");
  }
  return body.data;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", {
        timeZone: "America/Denver",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-white/10 bg-[#202725] p-5 shadow-[0_24px_70px_rgba(0,0,0,.22)] sm:p-7">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#efaa77]">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">{title}</h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function StatusPill({ healthy, configured = true }: { healthy: boolean; configured?: boolean }) {
  const label = !configured ? "Not configured" : healthy ? "Healthy" : "Unavailable";
  const tone = !configured
    ? "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
    : healthy
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
      : "border-amber-400/25 bg-amber-400/10 text-amber-200";
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [code, setCode] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [ragQuery, setRagQuery] = useState("dry needling");
  const [ragResult, setRagResult] = useState<RagResult | null>(null);
  const [providerQuery, setProviderQuery] = useState("Pregnancy care in Big Sky");
  const [providerResult, setProviderResult] = useState<ProviderResult | null>(null);

  async function loadOverview(activeCode: string) {
    setBusy(true);
    setError("");
    try {
      setOverview(await managerRequest<Overview>(activeCode, { action: "overview" }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load dashboard.");
      throw requestError;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void (async () => {
      const savedCode = window.sessionStorage.getItem(SESSION_KEY);
      if (!savedCode) {
        setCheckingSession(false);
        return;
      }
      try {
        const response = await fetch("/api/admin/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: savedCode }),
        });
        if (!response.ok) throw new Error("Session expired.");
        setCode(savedCode);
        setAuthenticated(true);
        await loadOverview(savedCode);
      } catch {
        window.sessionStorage.removeItem(SESSION_KEY);
      } finally {
        setCheckingSession(false);
      }
    })());
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) throw new Error("That manager code was not accepted.");
      window.sessionStorage.setItem(SESSION_KEY, code);
      setAuthenticated(true);
      await loadOverview(code);
    } catch (loginError) {
      setAuthenticated(false);
      setError(loginError instanceof Error ? loginError.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    window.sessionStorage.removeItem(SESSION_KEY);
    setCode("");
    setAuthenticated(false);
    setOverview(null);
    setConversation(null);
    setRagResult(null);
    setProviderResult(null);
  }

  async function openConversation(id: string) {
    setError("");
    try {
      setConversation(await managerRequest<ConversationDetail>(code, { action: "conversation", conversationId: id }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load conversation.");
    }
  }

  async function runRag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      setRagResult(await managerRequest<RagResult>(code, { action: "rag", query: ragQuery }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not inspect retrieval.");
    }
  }

  async function runProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      setProviderResult(await managerRequest<ProviderResult>(code, { action: "provider", query: providerQuery }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not inspect provider routing.");
    }
  }

  if (checkingSession) {
    return <main className="grid min-h-screen place-items-center bg-[#121715] text-zinc-300">Checking manager session…</main>;
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#25312c_0,#121715_48%)] px-5 text-white">
        <form onSubmit={handleLogin} className="w-full max-w-md rounded-3xl border border-white/10 bg-[#202725]/95 p-7 shadow-[0_30px_100px_rgba(0,0,0,.45)] sm:p-9">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#c86d36] text-xl font-black">W</div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-[#efaa77]">Private manager tool</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Wendy Manager Dashboard</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">Enter the server-configured manager code. It stays in this browser tab&apos;s session storage and is verified server-side.</p>
          <label className="mt-7 block text-sm font-medium text-zinc-200" htmlFor="manager-code">Manager code</label>
          <input id="manager-code" type="password" autoComplete="current-password" value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none ring-[#efaa77]/50 focus:ring-2" required />
          {error ? <p className="mt-3 text-sm text-amber-200">{error}</p> : null}
          <button disabled={busy} className="mt-5 w-full rounded-xl bg-[#d9783b] px-4 py-3 font-semibold text-white transition hover:bg-[#e4874b] disabled:opacity-60">{busy ? "Checking…" : "Open dashboard"}</button>
          <p className="mt-5 text-xs leading-5 text-zinc-500">Not linked from the public Wendy widget. No server secrets are sent to the browser.</p>
        </form>
      </main>
    );
  }

  if (!overview) {
    return <main className="grid min-h-screen place-items-center bg-[#121715] px-5 text-zinc-300"><div><p>{error || "Loading dashboard…"}</p><button onClick={() => void loadOverview(code)} className="mt-4 rounded-lg bg-[#d9783b] px-4 py-2 text-white">Retry</button></div></main>;
  }

  const funnelOrder = ["widget_loaded", "widget_opened", "message_sent", "assistant_response_received", "resource_recommended", "resource_clicked", "booking_link_clicked", "lead_form_opened", "lead_submitted"];
  const healthRows: Array<[string, HealthItem]> = [
    ["Application", overview.system.app],
    ["Supabase", overview.system.supabase],
    ["OpenAI", overview.system.openai],
    ["Monday", overview.system.monday],
    ["Blog index", overview.system.blogIndex],
    ["Knowledge manifest", overview.system.knowledgeManifest],
    ["Provider directory", overview.system.providerDirectory],
  ];

  return (
    <main className="min-h-screen bg-[#121715] text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#121715]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-7">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#efaa77]">Windy Ridge · Private</p><h1 className="text-xl font-semibold">Wendy Manager</h1></div>
          <div className="flex gap-2"><button onClick={() => void loadOverview(code)} disabled={busy} className="rounded-lg border border-white/10 px-3 py-2 text-sm hover:bg-white/5">Refresh</button><button onClick={logout} className="rounded-lg bg-white/8 px-3 py-2 text-sm hover:bg-white/12">Sign out</button></div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1500px] gap-7 px-4 py-7 sm:px-7 xl:grid-cols-[210px_minmax(0,1fr)]">
        <nav className="hidden self-start rounded-2xl border border-white/8 bg-[#1b211f] p-3 text-sm xl:sticky xl:top-24 xl:block">
          {[['health','System health'],['analytics','Analytics'],['conversations','Conversations'],['rag','RAG inspector'],['knowledge','Knowledge'],['providers','Provider routing'],['leads','Leads / Monday']].map(([href,label]) => <a key={href} href={`#${href}`} className="block rounded-lg px-3 py-2.5 text-zinc-400 hover:bg-white/5 hover:text-white">{label}</a>)}
        </nav>
        <div className="min-w-0 space-y-7">
          {error ? <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}

          <Section id="health" eyebrow="Operations" title="System Health">
            <div className="mb-5 rounded-2xl border border-[#efaa77]/15 bg-[#efaa77]/5 p-4"><p className="text-sm font-medium text-white">{overview.system.clinicTime.dayOfWeek}, {overview.system.clinicTime.date} · {overview.system.clinicTime.localTime}</p><p className="mt-1 text-xs text-zinc-400">Mountain Time · {overview.system.clinicTime.timeOfDay}</p></div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{healthRows.map(([label,item]) => <div key={label} className="rounded-2xl border border-white/8 bg-black/15 p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">{label}</p><StatusPill healthy={item.healthy} configured={item.configured} /></div>{item.note ? <p className="mt-3 text-xs leading-5 text-zinc-500">{item.note}</p> : null}</div>)}</div>
            <div className="mt-5 flex flex-wrap gap-2">{overview.system.recentFunctions.map((item) => <span key={item.name} className="rounded-full border border-white/8 bg-black/10 px-3 py-1.5 text-xs text-zinc-300">{item.name}: {item.healthy ? "healthy" : "unavailable"}</span>)}</div>
          </Section>

          <Section id="analytics" eyebrow="Funnel" title="Analytics Summary">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{funnelOrder.map((event) => <Metric key={event} label={event.replaceAll('_',' ')} value={overview.analytics.funnel[event] ?? 0} />)}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2"><Metric label="Total leads" value={overview.analytics.leadCount} /><Metric label="Total events" value={overview.analytics.totalEvents} /></div>
            <div className="mt-6 grid gap-5 lg:grid-cols-3">{[
              ["Top topics", overview.analytics.topTopics.map((item) => ({ label: item.topic, detail: item.count }))],
              ["Top pages", overview.analytics.topPages.map((item) => ({ label: item.pageTitle || item.pageUrl || "Unknown page", detail: item.count }))],
              ["Clicked resources", overview.analytics.topClickedResources.map((item) => ({ label: item.title || item.url || "Unknown resource", detail: item.count }))],
            ].map(([title,items]) => <div key={String(title)} className="rounded-2xl border border-white/8 bg-black/15 p-4"><h3 className="font-semibold">{String(title)}</h3><div className="mt-3 space-y-2">{(items as Array<{label:string;detail:number}>).length ? (items as Array<{label:string;detail:number}>).map((item) => <div key={item.label} className="flex justify-between gap-3 text-sm"><span className="truncate text-zinc-400">{item.label}</span><span>{item.detail}</span></div>) : <p className="text-sm text-zinc-500">No data available.</p>}</div></div>)}</div>
          </Section>

          <Section id="conversations" eyebrow="Short-term QA archive" title="Conversation Archive">
            <p className="mb-4 text-sm text-zinc-400">Only redacted archive content is available. Select a row to inspect user and assistant messages in order.</p>
            <div className="overflow-x-auto rounded-2xl border border-white/8"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-black/20 text-xs uppercase tracking-wider text-zinc-500"><tr>{["Time","Topic / intent","Page","Lead","Resources","Booking","Excerpt"].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-white/7">{overview.conversations.conversations.map((item) => <tr key={item.id} onClick={() => void openConversation(item.id)} className="cursor-pointer hover:bg-white/[.03]"><td className="whitespace-nowrap px-4 py-4">{formatDate(item.updatedAt)}</td><td className="px-4 py-4"><p>{item.inferredTopic || "Unknown"}</p><p className="mt-1 text-xs text-zinc-500">{item.detectedIntent || "No intent"}</p></td><td className="max-w-[180px] px-4 py-4"><p className="truncate">{item.pageTitle || item.pageUrl || "Unknown"}</p></td><td className="px-4 py-4">{item.leadSubmitted ? "Yes" : "No"}</td><td className="px-4 py-4">{item.resourceCount}</td><td className="px-4 py-4">{item.bookingClicked ? "Yes" : "No"}</td><td className="max-w-[340px] px-4 py-4 text-zinc-400"><p className="line-clamp-2">{item.excerpt}</p></td></tr>)}</tbody></table>{!overview.conversations.conversations.length ? <p className="p-5 text-sm text-zinc-500">Conversation archive unavailable or empty.</p> : null}</div>
            {conversation ? <div className="mt-5 rounded-2xl border border-[#efaa77]/20 bg-black/20 p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-[#efaa77]">Conversation detail</p><h3 className="mt-2 font-semibold">{conversation.conversation?.inferredTopic || "Archived conversation"}</h3></div><button onClick={() => setConversation(null)} className="text-sm text-zinc-400 hover:text-white">Close</button></div><div className="mt-5 space-y-3">{conversation.messages.map((message) => <div key={message.id} className={`rounded-2xl p-4 ${message.role === 'user' ? 'mr-8 bg-white/7' : 'ml-8 border border-[#efaa77]/15 bg-[#efaa77]/7'}`}><div className="flex justify-between gap-3 text-xs"><span className="font-bold uppercase tracking-wider text-zinc-300">{message.role === 'user' ? 'User' : 'Assistant'}</span><span className="text-zinc-600">{formatDate(message.createdAt)}{message.redacted ? ' · redacted' : ''}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{message.content}</p></div>)}</div></div> : null}
          </Section>

          <Section id="rag" eyebrow="Retrieval QA" title="RAG Inspector">
            <form onSubmit={runRag} className="flex flex-col gap-3 sm:flex-row"><input value={ragQuery} onChange={(event) => setRagQuery(event.target.value)} placeholder="Enter a query, e.g. dry needling" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:ring-2 focus:ring-[#efaa77]/40" /><button className="rounded-xl bg-[#d9783b] px-5 py-3 font-semibold hover:bg-[#e4874b]">Inspect retrieval</button></form>
            {ragResult ? <div className="mt-6"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Detected intent" value={ragResult.detectedIntent} /><Metric label="Retrieval mode" value={ragResult.retrievalMode} /><Metric label="Final resources" value={ragResult.finalResources.length} /></div><div className="mt-5 rounded-2xl border border-white/8 bg-black/15 p-4"><h3 className="font-semibold">Knowledge sources searched</h3><div className="mt-3 flex flex-wrap gap-2">{ragResult.sourcesSearched.map((source) => <span key={source.file} className="rounded-lg border border-white/8 px-2.5 py-1.5 text-xs text-zinc-400">{source.file} · {source.canonical ? 'canonical' : 'supplemental'}</span>)}</div></div><div className="mt-5 space-y-3"><h3 className="font-semibold">Ranked matches</h3>{ragResult.rankedMatches.map((match,index) => <article key={`${match.title}-${index}`} className="rounded-2xl border border-white/8 bg-black/15 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="min-w-0"><p className="font-medium">{index + 1}. {match.title}</p>{match.url ? <a href={match.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-[#efaa77]">{match.url}</a> : null}</div><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs ${match.status === 'accepted' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-zinc-500/10 text-zinc-400'}`}>{match.status}</span><span className="font-mono text-sm">{Math.round(match.score)}</span></div></div><p className="mt-3 text-xs text-zinc-500">{match.sourceType} · {match.category} · {match.tags.join(', ') || 'no tags'}</p><p className="mt-2 text-sm text-zinc-400">{match.reason}</p></article>)}</div>{ragResult.finalResources.length ? <div className="mt-5 rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-4"><h3 className="font-semibold">Final resources shown</h3>{ragResult.finalResources.map((resource) => <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer" className="mt-2 block text-sm text-emerald-200">{resource.title} · score {resource.score}</a>)}</div> : <p className="mt-5 text-sm text-zinc-500">No resource cards would be shown for this response mode.</p>}</div> : null}
          </Section>

          <Section id="knowledge" eyebrow="Canonical data" title="Knowledge Sources">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Blog index" value={overview.knowledge.blogIndexCount} /><Metric label="Knowledge chunks" value={overview.knowledge.knowledgeIndexChunkCount} /><Metric label="Providers" value={overview.knowledge.providerCount} /><Metric label="Stale provider refs" value={overview.knowledge.staleProviderReferenceCount} /></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/8 bg-black/15 p-4"><p className="text-sm text-zinc-400">Canonical blogs</p><p className="mt-2 break-all text-sm">{overview.knowledge.canonicalBlogFile}</p></div><div className="rounded-2xl border border-white/8 bg-black/15 p-4"><p className="text-sm text-zinc-400">Canonical clinic facts</p><p className="mt-2 break-all text-sm">{overview.knowledge.canonicalClinicFile}</p></div></div>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-white/8"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-black/20 text-xs uppercase tracking-wider text-zinc-500"><tr><th className="px-4 py-3">File</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Active</th><th className="px-4 py-3">Canonical</th><th className="px-4 py-3">Exists</th></tr></thead><tbody className="divide-y divide-white/7">{overview.knowledge.sources.map((source) => <tr key={source.file_path}><td className="px-4 py-3 font-mono text-xs">{source.file_path}</td><td className="px-4 py-3">{source.source_type}</td><td className="px-4 py-3">{source.used_by_retrieval ? 'Yes' : 'No'}</td><td className="px-4 py-3">{source.canonical ? 'Yes' : 'No'}</td><td className="px-4 py-3">{source.exists ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>
            <div className="mt-5 rounded-2xl border border-white/8 bg-black/15 p-4"><p className="font-medium">Warnings</p><ul className="mt-2 space-y-1 text-sm text-zinc-400">{[...overview.knowledge.staleProviderWarnings,...overview.knowledge.duplicateWarnings].length ? [...overview.knowledge.staleProviderWarnings,...overview.knowledge.duplicateWarnings].map((warning) => <li key={warning}>• {warning}</li>) : <li>No stale provider references or duplicate-source warnings.</li>}</ul></div>
          </Section>

          <Section id="providers" eyebrow="Deterministic matching" title="Provider Routing Inspector">
            <form onSubmit={runProvider} className="flex flex-col gap-3 sm:flex-row"><input value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder="Example patient question" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:ring-2 focus:ring-[#efaa77]/40" /><button className="rounded-xl bg-[#d9783b] px-5 py-3 font-semibold hover:bg-[#e4874b]">Inspect routing</button></form>
            {providerResult ? <div className="mt-6"><div className="grid gap-3 sm:grid-cols-2"><Metric label="Detected location" value={providerResult.detectedLocation} /><Metric label="Detected category" value={providerResult.detectedCategory} /></div><div className="mt-5 grid gap-3 lg:grid-cols-2">{providerResult.rankedProviders.length ? providerResult.rankedProviders.map((provider,index) => <article key={provider.id} className="rounded-2xl border border-white/8 bg-black/15 p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{index + 1}. {provider.name}</p><p className="mt-1 text-xs text-zinc-500">{provider.role} · {provider.locations.join(', ')}</p></div><span className="font-mono text-lg text-[#efaa77]">{provider.score}</span></div><p className="mt-3 text-sm text-zinc-400">{provider.availability || 'Confirm current availability.'}</p><ul className="mt-3 space-y-1 text-xs text-zinc-500">{provider.reasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul></article>) : <p className="text-sm text-zinc-500">No strong deterministic provider match.</p>}</div><div className="mt-5 rounded-2xl border border-white/8 bg-black/15 p-4"><h3 className="font-semibold">Final recommendation rules</h3><ul className="mt-3 space-y-2 text-sm text-zinc-400">{providerResult.recommendationRules.map((rule) => <li key={rule}>• {rule}</li>)}</ul></div></div> : null}
          </Section>

          <Section id="leads" eyebrow="Follow-up pipeline" title="Leads / Monday">
            <p className="mb-4 text-sm text-zinc-400">Names are masked in this QA view. Contact details and health-history fields are not returned.</p>
            <div className="overflow-x-auto rounded-2xl border border-white/8"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-black/20 text-xs uppercase tracking-wider text-zinc-500"><tr>{["Time","Lead","Location","Suggested provider","Submitted","Monday status","Monday item"].map((item) => <th key={item} className="px-4 py-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-white/7">{overview.leads.leads.map((lead) => <tr key={lead.id}><td className="whitespace-nowrap px-4 py-4">{formatDate(lead.createdAt)}</td><td className="px-4 py-4">{lead.displayName}</td><td className="px-4 py-4">{lead.preferredLocation || 'Unknown'}</td><td className="px-4 py-4">{lead.suggestedProvider || 'None'}</td><td className="px-4 py-4">{lead.leadSubmitted ? 'Yes' : 'No'}</td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs ${lead.mondayPushStatus === 'pushed' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-zinc-500/10 text-zinc-400'}`}>{lead.mondayPushStatus.replace('_',' ')}</span></td><td className="px-4 py-4 font-mono text-xs text-zinc-500">{lead.mondayItemId || '—'}</td></tr>)}</tbody></table>{!overview.leads.leads.length ? <p className="p-5 text-sm text-zinc-500">No recent leads available.</p> : null}</div>
          </Section>
        </div>
      </div>
    </main>
  );
}
