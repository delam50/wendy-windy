# Wendy Admin Diagnostics

Wendy supports a server-side admin diagnostics mode for authorized Windy Ridge managers. The admin code is checked only on the API route and must never be exposed in client-side code, WordPress snippets, public JavaScript, or documentation intended for website visitors.

## Vercel Environment Variable

In Vercel, set:

```txt
WENDY_ADMIN_CODE=[set a private manager code]
```

Recommended path:

Vercel Project -> Settings -> Environment Variables -> Add `WENDY_ADMIN_CODE` for Production, Preview, and Development as appropriate.

## Local Development Setup

Next.js reads server-side environment variables from `.env.local` during local development. Local admin diagnostics require `.env.local` at the app root.

If `.env.local` does not exist, create it and include:

```txt
WENDY_ADMIN_CODE=[your private manager code]
```

If `.env.local` already exists, add the same `WENDY_ADMIN_CODE` line to it. Keep this value server-side only. Do not put it in React components, WordPress embed snippets, browser JavaScript, or any `NEXT_PUBLIC_` variable.

## Supported Admin Commands

A manager can ask Wendy for diagnostics by including the admin code and one explicit command.

Safe test phrase example:

```txt
Give me Wendy status report [your admin code]
```

Supported command families include retrieval diagnostics, knowledge sources, provider knowledge, conversation review/detail, system health, and analytics. For example: `Show retrieval matches for dry needling`, `Show active knowledge sources`, `Show provider knowledge for Dr. Claire`, `Show recent Wendy conversations`, `Open recent-1`, and `Show analytics summary`.

Wendy parses an admin command only after the correct code is present. Without authorization, it returns no diagnostic data.

## Manager Dashboard

Authorized managers can open `/admin` directly. The dashboard is intentionally
not linked from the public Wendy widget and is marked `noindex` for search
engines.

Enter the value configured in the server-side `WENDY_ADMIN_CODE` environment
variable. The code is verified by a server API route and retained only in that
browser tab's `sessionStorage`; it is cleared when the manager signs out or the
tab session ends. The dashboard never returns environment values, Supabase
service-role credentials, OpenAI keys, Monday credentials, or hidden prompts.

Dashboard sections:

- **System Health:** configuration and safe health signals for the app,
  Mountain Time context, Supabase, OpenAI, Monday, blog index, knowledge
  manifest, provider directory, and recent server functions.
- **Analytics Summary:** aggregate Wendy funnel counts, top topics, top pages,
  clicked resources, and lead totals.
- **Conversation Archive:** recent short-term QA conversations and their stored
  redacted user/assistant messages in chronological order.
- **RAG Inspector:** query classification, sources searched, ranked knowledge
  matches, scores, acceptance decisions, and final resource cards.
- **Knowledge Sources:** canonical and supplemental files, source freshness,
  index counts, pricing/hours status, and stale knowledge warnings.
- **Provider Routing Inspector:** deterministic location/category detection,
  provider ranking scores and reasons, and current recommendation rules.
- **Leads / Monday:** recent masked lead summaries and available Monday push
  status. Contact details and health-history fields are not returned.

### Privacy and retention

The conversation archive is a short-term QA tool with a target retention period
of 30 days. Email addresses, phone numbers, and street addresses are redacted at
archive time. The dashboard omits system messages and shows only stored user and
assistant messages. Lead names are masked, and contact information is excluded.
This dashboard is not a medical record or a substitute for the clinic's approved
patient-record systems.

## What The Report Includes

The report may include safe operational metrics:

- app status
- current model name
- whether OpenAI is configured
- whether the blog index exists
- indexed blog resource count
- resource category count
- whether Jane/pricing knowledge exists
- whether provider routing knowledge exists
- conversation-insights endpoint health
- whether lead capture email appears configured
- recent safe analytics counts when local persistence is available
- common intent categories when available
- recent top topic categories when available

The report must not include:

- API keys
- environment variable values
- raw user messages
- detailed health information
- private lead data
- the admin code itself

## Production Analytics Behavior

Vercel serverless filesystems are not reliable persistent storage. Wendy disables production filesystem writes for conversation insights and adaptive prompt topic counts.

When configured, Wendy writes safe analytics, lead capture, and topic counts to Supabase using server-only environment variables:

```txt
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

These must be set in Vercel only as server-side environment variables. Never expose the service role key in client-side code, WordPress snippets, or any `NEXT_PUBLIC_` variable.

## Monday.com Lead Sync

Wendy can also create a new item on the Monday.com board after a lead is saved.

Board:

- Board ID: `18412623102`
- Board name: `Wendy Leads`

Required server-side environment variables:

```txt
MONDAY_API_KEY=
MONDAY_BOARD_ID=18412623102
MONDAY_COL_TIMING=text_mm38t4nz
MONDAY_COL_PAGE_URL=link_mm38z0hc
MONDAY_COL_PHONE=phone_mm38n1
MONDAY_COL_EMAIL=text_mm38jnwd
MONDAY_COL_LOCATION=color_mm38546x
MONDAY_COL_CONCERN=long_text_mm385e6m
MONDAY_COL_PROVIDER=color_mm382wx5
MONDAY_COL_STATUS=color_mm387nq4
```

Expected Monday labels:

- Preferred Location: `Four Corners`, `Big Sky`
- Suggested Provider: `Dr. Josh`, `Dr. Kyle`, `Dr. Dave`, `Dr. Claire`
- Status: `New`, `Contacted`, `Closed`

Wendy sets new leads to `Status = New`. Bozeman leads are mapped to the Monday `Four Corners` location label. If a label does not exactly match an existing Monday label, Wendy leaves that status/provider/location field blank rather than creating labels dynamically or failing the whole lead.

Monday sync happens after Supabase lead save. If Monday fails, Wendy logs a safe server-side warning and still keeps the visitor experience friendly when the lead was saved. Wendy does not send raw conversation transcripts or detailed health history to Monday.

In production:

- `/api/conversation-insights` returns `200 OK` even when persistence is skipped.
- analytics failures do not break chat, retrieval, lead capture, resource cards, or UI behavior.
- only safe metadata is handled.
- raw user messages and detailed health information are not stored.
- if Supabase variables are missing or a Supabase write fails, Wendy safely falls back without breaking the visitor experience.

In local development:

- conversation insights can be written to `data/generated/conversation-insights.json`
- topic counts can be written to `data/generated/question-topic-counts.json`

## Adaptive Quick Prompt Groundwork

Wendy can count only normalized topic categories, such as:

- back pain
- neck pain
- headaches
- dry needling
- pricing
- insurance
- first visit
- Big Sky
- Bozeman
- pregnancy
- pediatric/newborn
- massage
- animal chiropractic
- provider matching

Wendy does not store full visitor questions for adaptive prompts.

Prompt priority:

1. Strong page-context prompts from `pageTitle` / `pageUrl`
2. Local top topic categories, when available
3. Default Wendy prompts

Until persistent production storage is added, production deployments fall back to page-aware/default prompts.
