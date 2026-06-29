# Wendy Admin Diagnostics

Wendy supports a server-side admin diagnostics mode for authorized Windy Ridge managers. The admin code is checked only on the API route and must never be exposed in client-side code, WordPress snippets, public JavaScript, or documentation intended for website visitors.

## Vercel Environment Variable

In Vercel, set:

```txt
WENDY_ADMIN_CODE=43Milltown!
```

Recommended path:

Vercel Project -> Settings -> Environment Variables -> Add `WENDY_ADMIN_CODE` for Production, Preview, and Development as appropriate.

## Local Development Setup

Next.js reads server-side environment variables from `.env.local` during local development. Local admin diagnostics require `.env.local` at the app root.

If `.env.local` does not exist, create it and include:

```txt
WENDY_ADMIN_CODE=43Milltown!
```

If `.env.local` already exists, add the same `WENDY_ADMIN_CODE` line to it. Keep this value server-side only. Do not put it in React components, WordPress embed snippets, browser JavaScript, or any `NEXT_PUBLIC_` variable.

## How To Request A Status Report

A manager can ask Wendy for diagnostics by including the admin code and a status-style request in the chat message.

Safe test phrase example:

```txt
I am Dr. Kyle. Manager code: [your admin code]. Give me Wendy’s status report.
```

Wendy will only return diagnostics when the message includes the correct `WENDY_ADMIN_CODE` value and asks for status, diagnostics, usage, report, performance, health, or system report.

If someone asks for diagnostics without the code, Wendy will politely stay in general website-question mode.

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
