# Wendy Conversation Archive

Wendy can keep a short-term, privacy-conscious QA archive so the Windy Ridge team can review how recent conversations went, spot missing knowledge, and improve conversion.

This archive is not a medical record system. It is for lightweight quality review only.

## What To Create In Supabase

Run this SQL file in the Supabase SQL editor:

`supabase/wendy-conversation-archive.sql`

It creates:

- `wendy_conversations`: one summary row per Wendy browser session
- `wendy_messages`: short redacted user and assistant messages for QA review

The normal analytics funnel still writes to `wendy_events`. Conversation archive and analytics are intentionally separate.

## What Is Stored

Conversation summaries may store:

- timestamp
- Wendy session ID
- page title and URL
- inferred topic
- detected intent
- preferred location when available
- suggested provider when available
- whether a lead was submitted
- whether resources were recommended
- whether booking was clicked
- safe metadata

Messages may store:

- role: `user`, `assistant`, or `system`
- short message content, capped in length
- whether basic redaction was applied
- safe metadata

## What Is Not Stored

Wendy does not archive:

- API keys
- admin codes
- environment variable values
- hidden system prompts
- raw OpenAI prompt payloads
- retrieval chunks
- full conversation transcripts from every render
- private lead details beyond the visitor text already submitted through Wendy

Basic redaction is applied for obvious emails, phone numbers, and street addresses. This is a helpful safeguard, not a guarantee that every sensitive detail is removed.

## Retention

Default retention recommendation: **30 days**.

The code exports `WENDY_CONVERSATION_RETENTION_DAYS = 30` from `src/lib/conversationArchive.ts`.

Manual Supabase cleanup query:

```sql
delete from public.wendy_conversations
where created_at < now() - interval '30 days';
```

Messages are deleted automatically through `on delete cascade` when their parent conversation is removed.

The app includes a server-side cleanup helper, `deleteExpiredWendyConversations`, but it is not scheduled automatically. Use a Supabase scheduled job or manual SQL when ready.

## Admin Review

Authorized managers can ask Wendy for safe summaries using the admin code from `WENDY_ADMIN_CODE`.

Example prompts:

- `Manager code: [your admin code]. Show recent Wendy conversations.`
- `Manager code: [your admin code]. Show recent chats about dry needling.`
- `Manager code: [your admin code]. Show conversations that became leads.`
- `Manager code: [your admin code]. Show conversations where Wendy recommended resources.`

Admin review returns:

- timestamp
- topic
- intent
- page
- lead/resource/booking flags
- short redacted excerpt

It does not expose full private lead records, raw secrets, system prompts, or detailed medical histories.

## Production Safety

If Supabase is unavailable or the archive tables do not exist, Wendy continues normally. Archive failures are logged server-side with safe errors and do not break chat, lead capture, Monday.com, resource cards, or analytics.
