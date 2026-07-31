# Journaling System — Design Spec

**Date:** 2026-07-31
**Status:** Draft for user review
**Project:** Antigravity Quantitative Trading Journal

## 1. Purpose

Enable a trader to capture narrative trade reflections in two complementary ways:

1. **Conversational capture** — through the AI behavioral coach, by recognizing reflections in natural dialogue and proposing a `create_journal_entry` tool call.
2. **Direct capture** — through a dedicated, lightweight frontend form.

The journal is the durable home for reflections that are too qualitative to fit a numeric `Trade`, but too valuable to lose. It supports:

- Trade-linked postmortems.
- Standalone reflections, recovery notes, process observations, and trading philosophy.

Exact prices are **never required**. Approximate context (symbol, direction, size, duration, outcome) is optional but encouraged so entries can be filtered and retrieved by future tooling.

## 2. Goals and Non-Goals

### Goals

- Conversation-first journaling with a one-step coach proposal + user confirmation.
- A durable `JournalEntry` model with optional link to `Trade`.
- RAG integration so coach responses retrieve relevant past reflections.
- Lightweight create/edit/list/read UI in the frontend.
- Polished synthesized narrative plus immutable raw-conversation snapshot stored together.

### Non-Goals (Version 1)

- Voice-to-text journaling.
- Multi-entry linking (entries do not reference other entries).
- Image attachments on journal entries.
- Public sharing or export.
- Mobile-specific UX changes beyond responsive layout.

## 3. Core Decisions Locked From Brainstorming

- **Relationship to Trade:** Two flavors — entries may be linked to an existing `Trade` (optional FK) or stand alone.
- **Creation flow:** Both AI chat and dedicated form.
- **Structure:** One free-form `body` (markdown) plus optional structured fields. The body is the RAG source of truth.
- **AI Coach integration:** Embeds entries via existing embedding flow, retrieves by semantic similarity, and surfaces them in coach responses when relevant.
- **Save behavior:** Confirm before saving. The coach must summarize the proposed entry and ask for explicit confirmation.
- **Stored content:** Polished synthesis **plus** the raw conversation.
- **Raw conversation retention:** Immutable snapshot copied into the entry.
- **Quantitative metadata:** All numeric fields are optional. Prices can be entirely omitted.

## 4. Data Model

### New table: `JournalEntry`

| Field               | Type      | Notes                                                            |
|---------------------|-----------|------------------------------------------------------------------|
| `entry_id`          | String PK | UUID                                                             |
| `account_id`        | FK        | Required. References `Account`.                                  |
| `trade_id`          | FK?       | Optional. References `Trade`. Null = standalone reflection.      |
| `title`             | String    | Short human label, e.g. "First post-recovery MNQ trade".        |
| `entry_date`        | DateTime  | User-meaningful date of the experience (trade or reflection).    |
| `symbol`            | String?   | Optional. e.g. `MNQ`, `ES`.                                      |
| `direction`         | String?   | Optional. `LONG`, `SHORT`, or null.                              |
| `size_label`        | String?   | Optional. Free text, e.g. "2 MNQ" or "small".                   |
| `duration_label`    | String?   | Optional. Free text, e.g. "~7 hours".                           |
| `result_label`      | String?   | Optional. Free text, e.g. "+$540" or "clean execution".         |
| `emotional_state`   | String?   | Optional. e.g. "anxious → confident".                            |
| `context_summary`   | String?   | Optional. Short catalyst/setup summary.                          |
| `lesson`            | String?   | Optional. Extracted takeaway.                                    |
| `body`              | String    | Required. The polished narrative (markdown).                     |
| `raw_conversation`  | String    | Required. Immutable JSON snapshot of the relevant chat messages. |
| `source`            | String    | `AI_COACH` or `MANUAL_FORM`. Default: `MANUAL_FORM`.             |
| `created_at`        | DateTime  | Default `now()`.                                                 |

### Tag integration

Reuse the existing `Tag` / `TradeTag` pattern via a new junction table:

```
JournalEntryTag
  entry_tag_id PK
  entry_id FK
  tag_id FK
```

The V1 frontend surfaces only existing tags and the most common behavioral tags.

### Embedding

Reuse the existing embedding flow: a column `body_vector` (JSON-stringified floats, matching the existing `notes_vector` format) populated by the same embedding service used for `Trade.notes` and `ChatMessage.content`.

## 5. API Surface

All routes under the existing API prefix with `requireAuth` middleware.

- `GET    /api/journal-entries` — list, optional filters: `trade_id`, `symbol`, `from`, `to`, `source`, `tag`.
- `POST   /api/journal-entries` — create manually from the frontend form.
- `GET    /api/journal-entries/:entryId` — read one (returns body + raw conversation + tags + linked trade).
- `PATCH  /api/journal-entries/:entryId` — edit title/body/structured fields. Raw conversation is immutable.
- `DELETE /api/journal-entries/:entryId` — remove.

Internal flow for AI coach:

- `POST   /api/coach/journal/preview` — coach submits a candidate synthesis + structured fields + selected chat-message IDs. Backend returns a transient preview payload, tokens expire after 15 minutes, the frontend renders the preview for user confirmation.
- `POST   /api/coach/journal/confirm` — frontend confirms by passing back the preview token; backend takes a snapshot of the messages, embeds the body, and persists.

## 6. AI Coach Contract

### New tool: `create_journal_entry`

```json
{
  "name": "create_journal_entry",
  "description": "Propose a narrative journal entry. This returns a preview; the trader must confirm before it is persisted.",
  "parameters": {
    "type": "object",
    "properties": {
      "trade_id":         { "type": "string" },
      "title":            { "type": "string" },
      "entry_date":       { "type": "string", "format": "date-time" },
      "symbol":           { "type": "string" },
      "direction":        { "type": "string", "enum": ["LONG", "SHORT"] },
      "size_label":       { "type": "string" },
      "duration_label":   { "type": "string" },
      "result_label":     { "type": "string" },
      "emotional_state":  { "type": "string" },
      "context_summary":  { "type": "string" },
      "lesson":           { "type": "string" },
      "body":             { "type": "string" },
      "source_message_ids": {
        "type": "array",
        "items": { "type": "string" }
      },
      "tags":             { "type": "array", "items": { "type": "string" } }
    },
    "required": ["title", "body"] 
  }
}
```

The tool call surfaces a `[JOURNAL_PROPOSAL]` widget in the chat with:

- Title.
- Body preview.
- Structured fields.
- Confirm / Edit / Discard buttons.

Only `confirm` triggers `/api/coach/journal/confirm` and persists.

### RAG retrieval update

The existing `buildRagContext` (in `aiRouter.ts`) is extended to include:

- Top-K `Trade.notes` matches (current behavior).
- Top-K `JournalEntry.body` matches ranked by embedding similarity.
- A compact "Recent standalone reflections" block (last 5 entries, regardless of similarity) so the coach can reference the trader's recent qualitative state without needing semantic overlap.

## 7. Frontend

### New components

- `JournalListPage` — chronological feed of entries with filters (trade, symbol, source, tag).
- `JournalEntryView` — single-entry view, renders body + structured fields + raw conversation accordion.
- `JournalComposer` — lightweight form used both standalone and from the AI coach `Confirm` step.
- `JournalProposalCard` — embedded in `AICoach` chat as part of the `[JOURNAL_PROPOSAL]` widget.

### Navigation

A new top-level nav item **Journal** sits between **Dashboard** and **Playbooks**.

## 8. Error Handling

- **Embedding failure** — entry saves; UI shows "embedding pending, RAG search may miss this entry".
- **Coach LLM unavailable** — frontend form path is unaffected.
- **Snapshot read for a deleted message** — backend uses message IDs from the request, falls back gracefully if some are missing.
- **Race on confirm** — `confirm` returns 409 if the preview token was already used or expired.

## 9. Testing

- Unit: Prisma model behavior, snapshot serialization, embedding fallback.
- Integration: preview → confirm flow, edit preserves raw conversation, list filters.
- Coach: tool-call round trip with stubbed LLM, RAG inclusion for entries.

## 10. Rollout

A feature flag `ENABLE_JOURNALING` (env-driven, default `true` for V1) lets us disable the AI tool without removing the table while we tune the prompt.

## 11. Open Questions Deferred to V1.1

- Linking multiple entries to one trade.
- Day-view calendar grouping.
- Export to markdown / PDF.
- Coach auto-suggesting a journal entry when the user closes a trade.

---

**Approval gate:** This document is presented for user review. No code is written until the user approves this spec.
