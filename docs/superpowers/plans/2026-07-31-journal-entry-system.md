# Journal Entry System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversation-first narrative journaling to the Antigravity Trading Journal: a `JournalEntry` table that may link to an existing `Trade`, an AI Coach `create_journal_entry` tool that proposes entries via a preview token, manual CRUD endpoints, RAG integration, and a lightweight frontend composer + list page.

**Architecture:** New Prisma `JournalEntry` model with optional `trade_id` FK + a `JournalEntryTag` junction table. Backend adds REST endpoints (`/api/journal-entries`, `/api/coach/journal/preview`, `/api/coach/journal/confirm`), a new AI coach tool with two-stage confirm flow using a 15-minute preview token persisted in a `JournalPreview` table, and RAG retrieval over `JournalEntry.body` vectors. Frontend adds `JournalComposer`, `JournalListPage`, `JournalEntryView`, and a `JournalProposalCard` widget rendered inline in the existing `AICoach` chat when a `[JOURNAL_PROPOSAL]` token appears.

**Tech Stack:** TypeScript, Express, Prisma (SQLite), Jest (ts-jest), React + Vite, OpenAI tool-calling API, LM Studio embeddings.

**Spec:** `docs/superpowers/specs/2026-07-31-journal-entry-system-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/prisma/schema.prisma` | Add `JournalEntry`, `JournalPreview`, `JournalEntryTag` models |
| Create | `backend/src/services/journalEntry.ts` | Prisma data access for entries + tags |
| Create | `backend/src/services/journalEmbedding.ts` | Embedding helper + RAG search |
| Create | `backend/src/services/journalPreview.ts` | Preview token persistence + expiry |
| Create | `backend/src/routes/journalEntries.ts` | REST endpoints under `/api/journal-entries` |
| Create | `backend/src/routes/journalCoach.ts` | `/api/coach/journal/preview` and `/confirm` |
| Modify | `backend/src/services/aiRouter.ts` | Register `create_journal_entry` tool, extend RAG to include entries, handle proposal token in switch block |
| Modify | `backend/src/server.ts` | Wire new routers, set feature flag env read |
| Create | `backend/src/__tests__/journalEntries.test.ts` | Endpoint integration tests |
| Create | `backend/src/__tests__/journalEmbedding.test.ts` | Embedding helper tests |
| Create | `backend/src/__tests__/journalPreview.test.ts` | Preview token lifecycle tests |
| Create | `frontend/src/components/JournalComposer.tsx` | Form used standalone and by proposal card |
| Create | `frontend/src/components/JournalListPage.tsx` | List with filters (trade, symbol, source, tag) |
| Create | `frontend/src/components/JournalEntryView.tsx` | Single entry view, body + structured fields + raw conversation accordion |
| Create | `frontend/src/components/JournalProposalCard.tsx` | Chat-embedded Confirm/Edit/Discard widget |
| Modify | `frontend/src/components/AICoach.tsx` | Render `JournalProposalCard` on `[JOURNAL_PROPOSAL]` token |
| Modify | `frontend/src/App.tsx` | New "Journal" nav item between Dashboard and Playbooks |
| Modify | `frontend/src/lib/api.ts` | Typed wrappers for new endpoints |

---

## Global Constraints

- All numeric fields on a `JournalEntry` are optional; prices are never required.
- The `raw_conversation` snapshot is immutable once persisted.
- A preview token expires after 15 minutes; backend returns HTTP 409 on stale confirmations.
- Feature flag `ENABLE_JOURNALING` (env, default `true`) gates AI tool exposure only; manual endpoints are always live.
- RAG search reuses the existing `Trade.notes` and `ChatMessage.content` flow; do not introduce a new embedding provider.

---

## Task 1: Schema Migration  EJournalEntry, JournalPreview, JournalEntryTag

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add the three new models**

Append at the end of `backend/prisma/schema.prisma`:

```prisma
model JournalEntry {
  entry_id          String           @id @default(uuid())
  account_id        String
  trade_id          String?
  title             String
  entry_date        DateTime         @default(now())
  symbol            String?
  direction         String?
  size_label        String?
  duration_label    String?
  result_label      String?
  emotional_state   String?
  context_summary   String?
  lesson            String?
  body              String
  raw_conversation  String           // Immutable JSON snapshot of source messages
  body_vector       String?          // JSON-stringified floats, populated by embedding service
  source            String           @default("MANUAL_FORM") // AI_COACH or MANUAL_FORM
  created_at        DateTime         @default(now())
  account           Account          @relation(fields: [account_id], references: [account_id], onDelete: Cascade)
  trade             Trade?           @relation(fields: [trade_id], references: [trade_id], onDelete: SetNull)
  entry_tags        JournalEntryTag[]

  @@index([account_id])
  @@index([trade_id])
  @@index([entry_date])
}

model JournalEntryTag {
  entry_tag_id String       @id @default(uuid())
  entry_id     String
  tag_id       String
  entry        JournalEntry @relation(fields: [entry_id], references: [entry_id], onDelete: Cascade)
  tag          Tag          @relation(fields: [tag_id], references: [tag_id], onDelete: Cascade)

  @@unique([entry_id, tag_id])
}

model JournalPreview {
  preview_id         String   @id @default(uuid())
  token              String   @unique
  account_id         String
  proposed_payload   String   // JSON snapshot of candidate entry fields
  source_message_ids String   // JSON array of message IDs used to build raw conversation
  expires_at         DateTime
  consumed_at        DateTime?
  created_at         DateTime @default(now())
}
```

Also extend the existing `Account` and `Trade` models with back-relations:

```prisma
model Account {
  // ... existing fields ...
  journal_entries JournalEntry[]
}

model Trade {
  // ... existing fields ...
  journal_entries JournalEntry[]
}

model Tag {
  // ... existing fields ...
  journal_entry_tags JournalEntryTag[]
}
```

- [ ] **Step 2: Run prisma db push**

Run: `cd backend && npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Run prisma generate**

Run: `cd backend && npx prisma generate`
Expected: Prisma client regenerated successfully.

- [ ] **Step 4: Run existing test suite**

Run: `cd backend && npx jest`
Expected: All 100 existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat(schema): add JournalEntry, JournalPreview, JournalEntryTag"
```

---

## Task 2: journalEntry Service  EPrisma Data Access (TDD)

**Files:**
- Create: `backend/src/services/journalEntry.ts`
- Create: `backend/src/__tests__/journalEntry.test.ts`

**Interfaces:**
- Consumes: `prisma` (existing).
- Produces: `createJournalEntry(accountId, payload): Promise<JournalEntryWithRelations>`, `listJournalEntries(filters): Promise<JournalEntryWithRelations[]>`, `getJournalEntry(entryId): Promise<JournalEntryWithRelations | null>`, `updateJournalEntry(entryId, patch): Promise<JournalEntryWithRelations>`, `deleteJournalEntry(entryId): Promise<void>`.

- [ ] **Step 1: Write failing tests**

Create `backend/src/__tests__/journalEntry.test.ts`:

```typescript
import { createJournalEntry, listJournalEntries, getJournalEntry, updateJournalEntry, deleteJournalEntry } from "../services/journalEntry";

function createMockPrisma() {
  const journalEntry = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const journalEntryTag = { deleteMany: jest.fn(), create: jest.fn() };
  const tag = { findUnique: jest.fn(), create: jest.fn() };
  return { journalEntry, journalEntryTag, tag } as any;
}

const ACCOUNT_ID = "acct-1";
const ENTRY_ID = "entry-1";

describe("createJournalEntry", () => {
  test("creates an entry with required fields and attached tags", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.create.mockResolvedValue({ entry_id: ENTRY_ID, body: "x", tags: [] });
    prisma.tag.findUnique.mockResolvedValue(null);
    prisma.tag.create.mockResolvedValue({ tag_id: "tag-1", tag_name: "Patience" });

    const result = await createJournalEntry(prisma, ACCOUNT_ID, {
      title: "First post-recovery trade",
      body: "Long 2 MNQ, held overnight.",
      tags: ["Patience"],
    });

    expect(result.entry_id).toBe(ENTRY_ID);
    expect(prisma.journalEntry.create).toHaveBeenCalled();
    expect(prisma.journalEntryTag.create).toHaveBeenCalled();
  });
});

describe("listJournalEntries", () => {
  test("filters by accountId and trade_id", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.findMany.mockResolvedValue([]);
    await listJournalEntries(prisma, ACCOUNT_ID, { tradeId: "trade-1" });
    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ account_id: ACCOUNT_ID, trade_id: "trade-1" }) }),
    );
  });
});

describe("updateJournalEntry", () => {
  test("ignores attempts to patch raw_conversation", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.update.mockResolvedValue({ entry_id: ENTRY_ID });
    await updateJournalEntry(prisma, ENTRY_ID, { raw_conversation: "x" });
    const call = prisma.journalEntry.update.mock.calls[0][0];
    expect(call.data.raw_conversation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `cd backend && npx jest backend/src/__tests__/journalEntry.test.ts`
Expected: FAIL with "Cannot find module '../services/journalEntry'".

- [ ] **Step 3: Implement the service**

Create `backend/src/services/journalEntry.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";

export interface CreateJournalEntryInput {
  title: string;
  body: string;
  trade_id?: string;
  entry_date?: Date;
  symbol?: string;
  direction?: string;
  size_label?: string;
  duration_label?: string;
  result_label?: string;
  emotional_state?: string;
  context_summary?: string;
  lesson?: string;
  raw_conversation?: string;
  body_vector?: string | null;
  source?: string;
  tags?: string[];
}

export interface JournalEntryFilters {
  tradeId?: string;
  symbol?: string;
  source?: string;
  from?: Date;
  to?: Date;
  tag?: string;
}

async function ensureTag(prisma: PrismaClient, name: string) {
  const existing = await prisma.tag.findUnique({ where: { tag_name: name } });
  if (existing) return existing;
  return prisma.tag.create({
    data: { tag_category: "AI_GENERATED", tag_name: name, color_code: "#4A90E2" },
  });
}

export async function createJournalEntry(prisma: PrismaClient, accountId: string, input: CreateJournalEntryInput) {
  const entry = await prisma.journalEntry.create({
    data: {
      account_id: accountId,
      trade_id: input.trade_id,
      title: input.title,
      body: input.body,
      entry_date: input.entry_date ?? new Date(),
      symbol: input.symbol,
      direction: input.direction,
      size_label: input.size_label,
      duration_label: input.duration_label,
      result_label: input.result_label,
      emotional_state: input.emotional_state,
      context_summary: input.context_summary,
      lesson: input.lesson,
      raw_conversation: input.raw_conversation ?? "[]",
      body_vector: input.body_vector ?? null,
      source: input.source ?? "MANUAL_FORM",
    },
    include: { entry_tags: { include: { tag: true } } },
  });

  if (input.tags?.length) {
    for (const name of input.tags) {
      const tag = await ensureTag(prisma, name);
      await prisma.journalEntryTag.create({ data: { entry_id: entry.entry_id, tag_id: tag.tag_id } });
    }
  }
  return entry;
}

export async function listJournalEntries(prisma: PrismaClient, accountId: string, filters: JournalEntryFilters = {}) {
  return prisma.journalEntry.findMany({
    where: {
      account_id: accountId,
      trade_id: filters.tradeId,
      symbol: filters.symbol,
      source: filters.source,
      entry_date: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
      entry_tags: filters.tag ? { some: { tag: { tag_name: filters.tag } } } : undefined,
    },
    orderBy: { entry_date: "desc" },
    include: { entry_tags: { include: { tag: true } }, trade: true },
  });
}

export async function getJournalEntry(prisma: PrismaClient, entryId: string) {
  return prisma.journalEntry.findUnique({
    where: { entry_id: entryId },
    include: { entry_tags: { include: { tag: true } }, trade: true },
  });
}

export async function updateJournalEntry(
  prisma: PrismaClient,
  entryId: string,
  patch: Partial<CreateJournalEntryInput>,
) {
  // raw_conversation is immutable
  const { raw_conversation: _ignored, tags, ...data } = patch as any;

  const updated = await prisma.journalEntry.update({
    where: { entry_id: entryId },
    data,
    include: { entry_tags: { include: { tag: true } }, trade: true },
  });

  if (tags) {
    await prisma.journalEntryTag.deleteMany({ where: { entry_id: entryId } });
    for (const name of tags) {
      const tag = await ensureTag(prisma, name);
      await prisma.journalEntryTag.create({ data: { entry_id: entryId, tag_id: tag.tag_id } });
    }
  }
  return updated;
}

export async function deleteJournalEntry(prisma: PrismaClient, entryId: string) {
  await prisma.journalEntry.delete({ where: { entry_id: entryId } });
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `cd backend && npx jest backend/src/__tests__/journalEntry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/journalEntry.ts backend/src/__tests__/journalEntry.test.ts
git commit -m "feat(journal): add journalEntry data service"
```

---

## Task 3: journalEmbedding Service — Embeddings + RAG Search (TDD)

**Files:**
- Create: `backend/src/services/journalEmbedding.ts`
- Create: `backend/src/__tests__/journalEmbedding.test.ts`

**Interfaces:**
- Consumes: existing embedding client (from `aiRouter.ts`), `prisma`.
- Produces: `embedJournalEntryBody(entryId): Promise<void>`, `searchJournalEntries(accountId, query, topK): Promise<JournalEntryWithRelations[]>`, `getRecentStandaloneReflections(accountId, limit): Promise<JournalEntryWithRelations[]>`.

**Note on embedding format:** Match the existing codebase convention exactly — `notes_vector` is stored as `JSON.stringify(vec)` and parsed with `JSON.parse` (see `backend/src/server.ts:385` and `backend/src/services/aiRouter.ts:208`). The journal `body_vector` must use the same JSON-array-of-numbers string format so it stays consistent with `generateEmbedding` output.

- [ ] **Step 1: Write failing tests**

Create `backend/src/__tests__/journalEmbedding.test.ts`:

```typescript
import { embedJournalEntryBody, searchJournalEntries, getRecentStandaloneReflections } from "../services/journalEmbedding";

function createMockPrisma() {
  return {
    journalEntry: {
      update: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  } as any;
}

function createMockEmbeddings(responses: number[][]) {
  let i = 0;
  return {
    embed: jest.fn(async () => responses[i++] ?? []),
  } as any;
}

describe("embedJournalEntryBody", () => {
  test("stores JSON-stringified floats into body_vector (matches notes_vector format)", async () => {
    const prisma = createMockPrisma();
    const embeddings = createMockEmbeddings([[0.1, 0.2, 0.3]]);
    await embedJournalEntryBody(prisma, embeddings, "entry-1", "hello world");
    const updateCall = prisma.journalEntry.update.mock.calls[0][0];
    expect(updateCall.data.body_vector).toBe(JSON.stringify([0.1, 0.2, 0.3]));
  });
});

describe("searchJournalEntries", () => {
  test("returns top-K entries sorted by cosine similarity, parsing JSON vectors", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.findMany.mockResolvedValue([
      { entry_id: "a", body_vector: JSON.stringify([1, 0, 0]) },
      { entry_id: "b", body_vector: JSON.stringify([0, 1, 0]) },
    ]);
    const embeddings = createMockEmbeddings([[1, 0, 0]]);
    const result = await searchJournalEntries(prisma, embeddings, "acct-1", "query", 2);
    expect(result[0].entry_id).toBe("a");
  });
});

describe("getRecentStandaloneReflections", () => {
  test("queries by accountId, ordered by entry_date desc, no Trade FK", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.findMany.mockResolvedValue([]);
    await getRecentStandaloneReflections(prisma, "acct-1", 5);
    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ account_id: "acct-1", trade_id: null }),
        take: 5,
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `cd backend && npx jest backend/src/__tests__/journalEmbedding.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/journalEmbedding.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";

type EmbedFn = (text: string) => Promise<number[]>;

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function parseVector(raw: string | null): number[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function embedJournalEntryBody(prisma: PrismaClient, embeddings: { embed: EmbedFn }, entryId: string, body: string) {
  const vector = await embeddings.embed(body);
  await prisma.journalEntry.update({
    where: { entry_id: entryId },
    data: { body_vector: JSON.stringify(vector) },
  });
}

export async function searchJournalEntries(
  prisma: PrismaClient,
  embeddings: { embed: EmbedFn },
  accountId: string,
  query: string,
  topK = 5,
) {
  const queryVec = await embeddings.embed(query);
  const all = await prisma.journalEntry.findMany({
    where: { account_id: accountId, body_vector: { not: null } },
    take: 200,
    orderBy: { entry_date: "desc" },
  });
  const scored = all
    .map((e: any) => ({ e, score: cosine(queryVec, parseVector(e.body_vector)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored.map((s) => s.e);
}

export async function getRecentStandaloneReflections(prisma: PrismaClient, accountId: string, limit = 5) {
  return prisma.journalEntry.findMany({
    where: { account_id: accountId, trade_id: null },
    take: limit,
    orderBy: { entry_date: "desc" },
    include: { entry_tags: { include: { tag: true } } },
  });
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `cd backend && npx jest backend/src/__tests__/journalEmbedding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/journalEmbedding.ts backend/src/__tests__/journalEmbedding.test.ts
git commit -m "feat(journal): add embedding + RAG helpers for journal entries"
```

---

## Task 4: journalPreview Service  EToken Lifecycle (TDD)

**Files:**
- Create: `backend/src/services/journalPreview.ts`
- Create: `backend/src/__tests__/journalPreview.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces: `createPreview(accountId, payload, sourceMessageIds): Promise<{ token, expiresAt }>`, `consumePreview(token, accountId): Promise<PreviewRecord>`, `pruneExpiredPreviews(): Promise<number>`.

- [ ] **Step 1: Write failing tests**

Create `backend/src/__tests__/journalPreview.test.ts`:

```typescript
import { createPreview, consumePreview, pruneExpiredPreviews } from "../services/journalPreview";

function createMockPrisma() {
  const journalPreview = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  };
  return { journalPreview } as any;
}

const ACCOUNT_ID = "acct-1";
const TOKEN = "tok-abc";

describe("createPreview", () => {
  test("returns a token with expiry 15 minutes in the future", async () => {
    const prisma = createMockPrisma();
    prisma.journalPreview.create.mockResolvedValue({ token: TOKEN, expires_at: new Date(Date.now() + 1000) });
    const result = await createPreview(prisma, ACCOUNT_ID, { title: "t", body: "b" }, ["m1"]);
    expect(result.token).toBe(TOKEN);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });
});

describe("consumePreview", () => {
  test("marks preview consumed and returns payload", async () => {
    const prisma = createMockPrisma();
    prisma.journalPreview.findUnique.mockResolvedValue({
      token: TOKEN,
      account_id: ACCOUNT_ID,
      proposed_payload: '{"title":"t","body":"b"}',
      source_message_ids: '["m1"]',
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
    });
    const result = await consumePreview(prisma, TOKEN, ACCOUNT_ID);
    expect(result.payload.title).toBe("t");
    expect(prisma.journalPreview.update).toHaveBeenCalled();
  });

  test("throws on expired preview", async () => {
    const prisma = createMockPrisma();
    prisma.journalPreview.findUnique.mockResolvedValue({
      token: TOKEN,
      account_id: ACCOUNT_ID,
      proposed_payload: "{}",
      source_message_ids: "[]",
      expires_at: new Date(Date.now() - 1000),
      consumed_at: null,
    });
    await expect(consumePreview(prisma, TOKEN, ACCOUNT_ID)).rejects.toThrow(/expired/i);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `cd backend && npx jest backend/src/__tests__/journalPreview.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/services/journalPreview.ts`:

```typescript
import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export async function createPreview(prisma: PrismaClient, accountId: string, payload: unknown, sourceMessageIds: string[]) {
  const expiresAt = new Date(Date.now() + FIFTEEN_MINUTES_MS);
  const token = randomUUID();
  await prisma.journalPreview.create({
    data: {
      token,
      account_id: accountId,
      proposed_payload: JSON.stringify(payload),
      source_message_ids: JSON.stringify(sourceMessageIds),
      expires_at: expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function consumePreview(prisma: PrismaClient, token: string, accountId: string) {
  const record = await prisma.journalPreview.findUnique({ where: { token } });
  if (!record || record.account_id !== accountId) throw new Error("Preview not found");
  if (record.consumed_at) throw new Error("Preview already consumed");
  if (record.expires_at.getTime() < Date.now()) throw new Error("Preview expired");

  await prisma.journalPreview.update({
    where: { token },
    data: { consumed_at: new Date() },
  });

  return {
    payload: JSON.parse(record.proposed_payload),
    sourceMessageIds: JSON.parse(record.source_message_ids),
  };
}

export async function pruneExpiredPreviews(prisma: PrismaClient) {
  const result = await prisma.journalPreview.deleteMany({
    where: { expires_at: { lt: new Date() } },
  });
  return result.count;
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `cd backend && npx jest backend/src/__tests__/journalPreview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/journalPreview.ts backend/src/__tests__/journalPreview.test.ts
git commit -m "feat(journal): add preview token lifecycle service"
```

---

## Task 5: REST Endpoints  EjournalEntries Router

**Files:**
- Create: `backend/src/routes/journalEntries.ts`
- Create: `backend/src/__tests__/journalEntriesEndpoint.test.ts`
- Modify: `backend/src/server.ts` (mount router)

**Interfaces:**
- Consumes: existing auth middleware, `prisma`.
- Produces:
  - `GET /api/journal-entries?accountId=…&tradeId=…&symbol=…&source=…&tag=…&from=…&to=…`
  - `POST /api/journal-entries`
  - `GET /api/journal-entries/:entryId`
  - `PATCH /api/journal-entries/:entryId`
  - `DELETE /api/journal-entries/:entryId`

- [ ] **Step 1: Write failing endpoint tests**

Create `backend/src/__tests__/journalEntriesEndpoint.test.ts`. The codebase pattern is mock-prisma unit tests (see `chatSession.test.ts`); there is no `supertest` dependency, so the router handlers are exported as named functions and tested by invoking them with mock `req`/`res` objects.

```typescript
import {
  journalEntriesRouter,
  listJournalEntriesHandler,
  createJournalEntryHandler,
  getJournalEntryHandler,
  updateJournalEntryHandler,
  deleteJournalEntryHandler,
} from "../routes/journalEntries";

// Reuse the mock-prisma pattern from chatSession.test.ts
function createMockPrisma() {
  return {
    journalEntry: {
      create: jest.fn().mockResolvedValue({ entry_id: "e1" }),
      findMany: jest.fn().mockResolvedValue([{ entry_id: "e1" }]),
      findUnique: jest.fn().mockResolvedValue({ entry_id: "e1" }),
      update: jest.fn().mockResolvedValue({ entry_id: "e1" }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    tag: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    journalEntryTag: { deleteMany: jest.fn(), create: jest.fn() },
  } as any;
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload: any) => { res.body = payload; return res; });
  return res;
}

describe("listJournalEntriesHandler", () => {
  test("requires accountId", async () => {
    const res = mockRes();
    await listJournalEntriesHandler({ query: {} } as any, res);
    expect(res.statusCode).toBe(400);
  });

  test("lists entries for the account", async () => {
    const prisma = createMockPrisma();
    const res = mockRes();
    await listJournalEntriesHandler({ query: { accountId: "acc-1" }, prisma } as any, res);
    expect(res.statusCode).toBe(200);
    expect(prisma.journalEntry.findMany).toHaveBeenCalled();
  });
});

describe("createJournalEntryHandler", () => {
  test("requires title and body", async () => {
    const res = mockRes();
    await createJournalEntryHandler({ body: { accountId: "acc-1" }, prisma: createMockPrisma() } as any, res);
    expect(res.statusCode).toBe(400);
  });

  test("creates entry with valid payload", async () => {
    const prisma = createMockPrisma();
    const res = mockRes();
    await createJournalEntryHandler({ body: { accountId: "acc-1", title: "t", body: "b" }, prisma } as any, res);
    expect(res.statusCode).toBe(200);
    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });
});

describe("getJournalEntryHandler", () => {
  test("returns 404 when entry missing", async () => {
    const prisma = createMockPrisma();
    prisma.journalEntry.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await getJournalEntryHandler({ params: { entryId: "missing" }, prisma } as any, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("updateJournalEntryHandler", () => {
  test("delegates to updateJournalEntry", async () => {
    const prisma = createMockPrisma();
    const res = mockRes();
    await updateJournalEntryHandler({ params: { entryId: "e1" }, body: { title: "new" }, prisma } as any, res);
    expect(prisma.journalEntry.update).toHaveBeenCalled();
  });
});

describe("deleteJournalEntryHandler", () => {
  test("calls delete", async () => {
    const prisma = createMockPrisma();
    const res = mockRes();
    await deleteJournalEntryHandler({ params: { entryId: "e1" }, prisma } as any, res);
    expect(prisma.journalEntry.delete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `cd backend && npx jest backend/src/__tests__/journalEntriesEndpoint.test.ts`
Expected: FAIL with "Cannot find module '../routes/journalEntries'".

- [ ] **Step 3: Implement the router**

Create `backend/src/routes/journalEntries.ts`. Export both the router and the named handler functions so they can be unit-tested without `supertest`:

```typescript
import { Router } from "express";
import {
  createJournalEntry,
  listJournalEntries,
  getJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
} from "../services/journalEntry";

export async function listJournalEntriesHandler(req: any, res: any) {
  const { accountId, tradeId, symbol, source, tag, from, to } = req.query;
  if (!accountId) return res.status(400).json({ error: "accountId required" });
  const entries = await listJournalEntries(req.prisma, String(accountId), {
    tradeId: tradeId as string | undefined,
    symbol: symbol as string | undefined,
    source: source as string | undefined,
    tag: tag as string | undefined,
    from: from ? new Date(String(from)) : undefined,
    to: to ? new Date(String(to)) : undefined,
  });
  res.json(entries);
}

export async function createJournalEntryHandler(req: any, res: any) {
  const { accountId, ...payload } = req.body;
  if (!accountId || !payload.title || !payload.body) return res.status(400).json({ error: "accountId, title, and body required" });
  const entry = await createJournalEntry(req.prisma, accountId, { ...payload, source: payload.source ?? "MANUAL_FORM" });
  res.json(entry);
}

export async function getJournalEntryHandler(req: any, res: any) {
  const entry = await getJournalEntry(req.prisma, req.params.entryId);
  if (!entry) return res.status(404).json({ error: "not found" });
  res.json(entry);
}

export async function updateJournalEntryHandler(req: any, res: any) {
  const updated = await updateJournalEntry(req.prisma, req.params.entryId, req.body);
  res.json(updated);
}

export async function deleteJournalEntryHandler(req: any, res: any) {
  await deleteJournalEntry(req.prisma, req.params.entryId);
  res.json({ ok: true });
}

export const journalEntriesRouter = Router();
journalEntriesRouter.get("/", listJournalEntriesHandler);
journalEntriesRouter.post("/", createJournalEntryHandler);
journalEntriesRouter.get("/:entryId", getJournalEntryHandler);
journalEntriesRouter.patch("/:entryId", updateJournalEntryHandler);
journalEntriesRouter.delete("/:entryId", deleteJournalEntryHandler);
```

- [ ] **Step 4: Mount the router in `server.ts`**

In `backend/src/server.ts`, after the existing route mounts (search for `app.use(`), add:

```typescript
import { journalEntriesRouter } from "./routes/journalEntries";
// ...
app.use("/api/journal-entries", journalEntriesRouter);
```

Confirm `req.prisma` is already populated by existing middleware; otherwise wire `app.use((req, _res, next) => { req.prisma = prisma; next(); })` in the same place the existing routers do it.

- [ ] **Step 5: Run tests, expect pass**

Run: `cd backend && npx jest backend/src/__tests__/journalEntriesEndpoint.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/journalEntries.ts backend/src/__tests__/journalEntriesEndpoint.test.ts backend/src/server.ts
git commit -m "feat(journal): expose manual CRUD endpoints for journal entries"
```

---

## Task 6: Coach Preview/Confirm Endpoints

**Files:**
- Create: `backend/src/routes/journalCoach.ts`
- Create: `backend/src/__tests__/journalCoachEndpoint.test.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Produces:
  - `POST /api/coach/journal/preview` (body: candidate payload + message IDs) returns `{ token, expiresAt, payload }`.
  - `POST /api/coach/journal/confirm` (body: token + edits) returns the persisted entry, including `raw_conversation` snapshotted from the source messages.

- [ ] **Step 1: Write failing tests**

Create `backend/src/__tests__/journalCoachEndpoint.test.ts`. Same pattern as Task 5 — named handler functions tested with mock `req`/`res` (no `supertest`):

```typescript
import {
  journalCoachRouter,
  previewJournalEntryHandler,
  confirmJournalEntryHandler,
} from "../routes/journalCoach";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload: any) => { res.body = payload; return res; });
  return res;
}

describe("previewJournalEntryHandler", () => {
  test("requires accountId and payload", async () => {
    const res = mockRes();
    await previewJournalEntryHandler({ body: {}, prisma: {} } as any, res);
    expect(res.statusCode).toBe(400);
  });

  test("issues a token valid for 15 minutes", async () => {
    const prisma = {
      journalPreview: { create: jest.fn().mockResolvedValue(undefined) },
    } as any;
    const res = mockRes();
    await previewJournalEntryHandler(
      { body: { accountId: "a", payload: { title: "t", body: "b" }, sourceMessageIds: [] }, prisma } as any,
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});

describe("confirmJournalEntryHandler", () => {
  test("returns 409 when token is invalid or already consumed", async () => {
    const prisma = {
      journalPreview: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const res = mockRes();
    await confirmJournalEntryHandler({ body: { accountId: "a", token: "missing" }, prisma } as any, res);
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `cd backend && npx jest backend/src/__tests__/journalCoachEndpoint.test.ts`
Expected: FAIL with "Cannot find module '../routes/journalCoach'".

- [ ] **Step 3: Implement the router**

Create `backend/src/routes/journalCoach.ts`:

```typescript
import { Router } from "express";
import { createPreview, consumePreview } from "../services/journalPreview";
import { createJournalEntry } from "../services/journalEntry";
import { embedJournalEntryBody } from "../services/journalEmbedding";

export async function previewJournalEntryHandler(req: any, res: any) {
  const { accountId, payload, sourceMessageIds } = req.body;
  if (!accountId || !payload) return res.status(400).json({ error: "accountId and payload required" });
  const { token, expiresAt } = await createPreview(req.prisma, accountId, payload, sourceMessageIds ?? []);
  res.json({ token, expiresAt, payload });
}

export async function confirmJournalEntryHandler(req: any, res: any) {
  const { accountId, token, edits } = req.body;
  if (!accountId || !token) return res.status(400).json({ error: "accountId and token required" });

  let preview: { payload: any; sourceMessageIds: string[] };
  try {
    preview = await consumePreview(req.prisma, token, accountId);
  } catch (err: any) {
    return res.status(409).json({ error: err.message });
  }

  // Snapshot the source messages into raw_conversation
  const messages = await req.prisma.chatMessage.findMany({
    where: { message_id: { in: preview.sourceMessageIds } },
    orderBy: { created_at: "asc" },
  });
  const rawConversation = JSON.stringify(messages.map((m: any) => ({
    message_id: m.message_id,
    role: m.role,
    content: m.content,
    created_at: m.created_at,
  })));

  const merged = { ...preview.payload, ...(edits ?? {}), raw_conversation: rawConversation, source: "AI_COACH" };
  const entry = await createJournalEntry(req.prisma, accountId, merged);

  // Best-effort embedding; failure does not block persistence
  try {
    await embedJournalEntryBody(req.prisma, req.embedder, entry.entry_id, entry.body);
  } catch (e) {
    console.warn("journal embedding failed:", e);
  }

  res.json(entry);
}

export const journalCoachRouter = Router();
journalCoachRouter.post("/preview", previewJournalEntryHandler);
journalCoachRouter.post("/confirm", confirmJournalEntryHandler);
```

- [ ] **Step 4: Mount the router in `server.ts`**

In `backend/src/server.ts`, alongside the other coach routes (search for existing coach route mounts), add:

```typescript
import { journalCoachRouter } from "./routes/journalCoach";
// ...
app.use("/api/coach/journal", journalCoachRouter);
```

If the existing app passes an `embedder` to other routes, expose it on the request similarly (e.g., `req.embedder = …`).

- [ ] **Step 5: Run tests, expect pass**

Run: `cd backend && npx jest backend/src/__tests__/journalCoachEndpoint.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/journalCoach.ts backend/src/__tests__/journalCoachEndpoint.test.ts backend/src/server.ts
git commit -m "feat(journal): expose AI coach preview/confirm endpoints"
```

---

## Task 7: AI Coach Tool Definition + RAG Update + Switch Handler

**Files:**
- Modify: `backend/src/services/aiRouter.ts`

**Interfaces:**
- Produces:
  - Adds `create_journal_entry` to `tools` array (gated by `process.env.ENABLE_JOURNALING`).
  - Extends `buildRagContext` (around line 198 in current file) to call `searchJournalEntries` and `getRecentStandaloneReflections` and append to `notesContext`.
  - In `executeToolCalls` (around line 824), handle `create_journal_entry` by calling `/api/coach/journal/preview` and emitting a `[JOURNAL_PROPOSAL]` token + payload.

- [ ] **Step 1: Add the tool definition and register it in the inline tools array**

In `aiRouter.ts`, after `recordObservationTool` (around line 320), add:

```typescript
const createJournalEntryTool = {
  type: "function" as const,
  function: {
    name: "create_journal_entry",
    description: "Propose a narrative journal entry. This returns a preview to the user; nothing is persisted until they confirm.",
    parameters: {
      type: "object",
      properties: {
        trade_id:         { type: "string" },
        title:            { type: "string" },
        entry_date:       { type: "string", format: "date-time" },
        symbol:           { type: "string" },
        direction:        { type: "string", enum: ["LONG", "SHORT"] },
        size_label:       { type: "string" },
        duration_label:   { type: "string" },
        result_label:     { type: "string" },
        emotional_state:  { type: "string" },
        context_summary:  { type: "string" },
        lesson:           { type: "string" },
        body:             { type: "string" },
        source_message_ids: { type: "array", items: { type: "string" } },
        tags:             { type: "array", items: { type: "string" } }
      },
      required: ["title", "body"]
    }
  }
};
```

Then update the inline `tools:` array at line 775 — it is written literally in the `openai.chat.completions.create` call, not a separate variable. Replace:

```typescript
tools: [logTradeTool, renderUiTool, recordObservationTool, tagTradeTool, toggleLensTool],
```

with:

```typescript
tools: [
  logTradeTool,
  renderUiTool,
  recordObservationTool,
  tagTradeTool,
  toggleLensTool,
  ...(process.env.ENABLE_JOURNALING === "false" ? [] : [createJournalEntryTool]),
],
```

- [ ] **Step 2: Extend RAG context**

In `aiRouter.ts` `buildRagContext`, after the existing qualitative notes search (around line 238, before the `return` at line 240), append the journal retrieval. Note the module-level `prisma` and `generateEmbedding` are already in scope in this file — reuse them, and adapt the `notesContext` variable in place (do not redeclare it):

```typescript
import { searchJournalEntries, getRecentStandaloneReflections } from "./journalEmbedding";
// ...at the end of buildRagContext, just before `return { statsText, notesContext };`:
const journalMatches = await searchJournalEntries(prisma, { embed: generateEmbedding }, accountId, userQuery, 5).catch(() => []);
const recentReflections = await getRecentStandaloneReflections(prisma, accountId, 5).catch(() => []);
const journalSection = [
  recentReflections.length ? `Recent standalone reflections:\n${recentReflections.map((e) => `- ${e.entry_date.toISOString().slice(0,10)}: ${e.body}`).join("\n")}` : "",
  journalMatches.length ? `Semantically related journal entries:\n${journalMatches.map((e) => `- ${e.title}: ${e.body}`).join("\n")}` : "",
].filter(Boolean).join("\n\n");
if (journalSection) {
  notesContext = `${notesContext}\n\n${journalSection}`;
}
```

(Use `searchJournalEntries(prisma, { embed: generateEmbedding }, ...)` — the `{ embed: generateEmbedding }` shape matches the service's `{ embed: EmbedFn }` parameter.)

- [ ] **Step 3: Handle the tool in the switch**

In `executeToolCalls`, add a case for `create_journal_entry`:

```typescript
case "create_journal_entry":
  const previewRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/coach/journal/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId,
      payload: args,
      sourceMessageIds: args.source_message_ids ?? [],
    }),
  });
  const preview = await previewRes.json();
  const widget = `\n\n[JOURNAL_PROPOSAL: ${JSON.stringify({ ...preview, payload: args })}]\n\n`;
  fullText += widget;
  onToken(widget);
  break;
```

(The `[JOURNAL_PROPOSAL: …]` token is parsed by `JournalProposalCard`. It contains the `token`, `expiresAt`, the candidate payload, and the list of message IDs so the frontend can show edit/discard/confirm buttons.)

- [ ] **Step 4: Run all backend tests**

Run: `cd backend && npx jest`
Expected: All tests pass (no regressions). New tests still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/aiRouter.ts
git commit -m "feat(coach): register create_journal_entry tool, expand RAG to journal entries"
```

---

## Task 8: Frontend API Wrappers

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces: typed `listJournalEntries`, `createJournalEntry`, `getJournalEntry`, `updateJournalEntry`, `deleteJournalEntry`, `previewJournalEntry`, `confirmJournalEntry`.

- [ ] **Step 1: Add wrappers**

Append to `frontend/src/lib/api.ts`:

```typescript
export interface JournalEntry {
  entry_id: string;
  account_id: string;
  trade_id: string | null;
  title: string;
  body: string;
  entry_date: string;
  symbol: string | null;
  direction: string | null;
  size_label: string | null;
  duration_label: string | null;
  result_label: string | null;
  emotional_state: string | null;
  context_summary: string | null;
  lesson: string | null;
  raw_conversation: string;
  body_vector: string | null;
  source: string;
  created_at: string;
  entry_tags?: { tag: { tag_id: string; tag_name: string } }[];
  trade?: Trade | null;
}

export const listJournalEntries = (params: Record<string, string | number | undefined>) =>
  fetch(`${API_BASE}/api/journal-entries?${new URLSearchParams(params as any)}`).then((r) => r.json());

export const createJournalEntry = (payload: Partial<JournalEntry> & { accountId: string }) =>
  fetch(`${API_BASE}/api/journal-entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

export const getJournalEntry = (entryId: string) =>
  fetch(`${API_BASE}/api/journal-entries/${entryId}`).then((r) => r.json());

export const updateJournalEntry = (entryId: string, patch: Partial<JournalEntry>) =>
  fetch(`${API_BASE}/api/journal-entries/${entryId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => r.json());

export const deleteJournalEntry = (entryId: string) =>
  fetch(`${API_BASE}/api/journal-entries/${entryId}`, { method: "DELETE" }).then((r) => r.json());

export const previewJournalEntry = (payload: { accountId: string; payload: any; sourceMessageIds?: string[] }) =>
  fetch(`${API_BASE}/api/coach/journal/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());

export const confirmJournalEntry = (payload: { accountId: string; token: string; edits?: any }) =>
  fetch(`${API_BASE}/api/coach/journal/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => r.json());
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(journal): add frontend API wrappers for journal entries"
```

---

## Task 9: JournalComposer, JournalListPage, JournalEntryView Components

**Files:**
- Create: `frontend/src/components/JournalComposer.tsx`
- Create: `frontend/src/components/JournalListPage.tsx`
- Create: `frontend/src/components/JournalEntryView.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- `JournalComposer` accepts `{ accountId, initial?: Partial<JournalEntry>, onSaved?: (entry: JournalEntry) => void }` and renders a markdown body + structured-fields form. Standalone or embedded in the proposal card.
- `JournalListPage` accepts `{ accountId }` and lists entries with filters.
- `JournalEntryView` accepts `{ entry, onClose }` and shows body + structured fields + raw conversation accordion + tags + linked trade.

- [ ] **Step 1: Implement `JournalComposer`**

Create `frontend/src/components/JournalComposer.tsx`:

```tsx
import { useState } from "react";
import { createJournalEntry, JournalEntry } from "../lib/api";

interface Props {
  accountId: string;
  initial?: Partial<JournalEntry>;
  onSaved?: (entry: JournalEntry) => void;
  onCancel?: () => void;
}

export default function JournalComposer({ accountId, initial, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [direction, setDirection] = useState(initial?.direction ?? "");
  const [sizeLabel, setSizeLabel] = useState(initial?.size_label ?? "");
  const [durationLabel, setDurationLabel] = useState(initial?.duration_label ?? "");
  const [resultLabel, setResultLabel] = useState(initial?.result_label ?? "");
  const [emotionalState, setEmotionalState] = useState(initial?.emotional_state ?? "");
  const [contextSummary, setContextSummary] = useState(initial?.context_summary ?? "");
  const [lesson, setLesson] = useState(initial?.lesson ?? "");
  const [tags, setTags] = useState((initial as any)?.tags?.join(", ") ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title || !body) return;
    setBusy(true);
    const entry = await createJournalEntry({
      accountId,
      title,
      body,
      symbol: symbol || undefined,
      direction: direction || undefined,
      size_label: sizeLabel || undefined,
      duration_label: durationLabel || undefined,
      result_label: resultLabel || undefined,
      emotional_state: emotionalState || undefined,
      context_summary: contextSummary || undefined,
      lesson: lesson || undefined,
      tags: tags ? tags.split(",").map((t: string) => t.trim()).filter(Boolean) : undefined,
    });
    setBusy(false);
    onSaved?.(entry);
  };

  return (
    <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reflect on what happened, why, and what you learned…" rows={8} />
      <details>
        <summary>Optional trade context</summary>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol (e.g. MNQ)" />
          <input value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="LONG or SHORT" />
          <input value={sizeLabel} onChange={(e) => setSizeLabel(e.target.value)} placeholder="Size (e.g. 2 MNQ)" />
          <input value={durationLabel} onChange={(e) => setDurationLabel(e.target.value)} placeholder="Duration (e.g. ~7 hours)" />
          <input value={resultLabel} onChange={(e) => setResultLabel(e.target.value)} placeholder="Result (e.g. +$540)" />
          <input value={emotionalState} onChange={(e) => setEmotionalState(e.target.value)} placeholder="Emotional state" />
          <input value={contextSummary} onChange={(e) => setContextSummary(e.target.value)} placeholder="Context summary" />
          <input value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="Lesson" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma-separated" />
        </div>
      </details>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" disabled={busy || !title || !body} onClick={submit}>Save entry</button>
        {onCancel && <button className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `JournalListPage`**

Create `frontend/src/components/JournalListPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { listJournalEntries, JournalEntry } from "../lib/api";
import JournalComposer from "./JournalComposer";
import JournalEntryView from "./JournalEntryView";

export default function JournalListPage({ accountId }: { accountId: string }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [composing, setComposing] = useState(false);
  const [viewing, setViewing] = useState<JournalEntry | null>(null);

  const reload = async () => setEntries(await listJournalEntries({ accountId }));
  useEffect(() => { reload(); }, [accountId]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Journal</h2>
        <button className="btn-primary" onClick={() => setComposing(true)}>New entry</button>
      </header>
      {composing && (
        <JournalComposer accountId={accountId} onSaved={() => { setComposing(false); reload(); }} onCancel={() => setComposing(false)} />
      )}
      <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0 }}>
        {entries.map((e) => (
          <li key={e.entry_id} className="card" style={{ padding: 12, cursor: "pointer" }} onClick={() => setViewing(e)}>
            <strong>{e.title}</strong>
            <div style={{ opacity: 0.7, fontSize: "0.85rem" }}>
              {new Date(e.entry_date).toLocaleDateString()} · {e.symbol ?? " E} · {e.source}
            </div>
          </li>
        ))}
      </ul>
      {viewing && (
        <div role="dialog" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center" }}>
          <div style={{ background: "var(--bg-primary)", padding: 20, borderRadius: 8, maxWidth: 720, width: "100%" }}>
            <JournalEntryView entry={viewing} onClose={() => setViewing(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement `JournalEntryView`**

Create `frontend/src/components/JournalEntryView.tsx`:

```tsx
import { JournalEntry } from "../lib/api";

export default function JournalEntryView({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>{entry.title}</h3>
        <button className="btn-secondary" onClick={onClose}>Close</button>
      </header>
      <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>
        {new Date(entry.entry_date).toLocaleString()} · {entry.symbol ?? " E} · {entry.source}
      </div>
      {entry.trade_id && <div>Linked to trade: {entry.trade_id.slice(0, 8)}…</div>}
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{entry.body}</pre>
      {(entry.context_summary || entry.lesson || entry.emotional_state) && (
        <section>
          <strong>Structured fields</strong>
          <ul>
            {entry.context_summary && <li><b>Context:</b> {entry.context_summary}</li>}
            {entry.emotional_state && <li><b>Emotional state:</b> {entry.emotional_state}</li>}
            {entry.result_label && <li><b>Result:</b> {entry.result_label}</li>}
            {entry.lesson && <li><b>Lesson:</b> {entry.lesson}</li>}
          </ul>
        </section>
      )}
      <details>
        <summary>Raw conversation (immutable snapshot)</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
{entry.raw_conversation}
        </pre>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Add a Journal nav item to `App.tsx`**

In `frontend/src/App.tsx`:

1. Import the component near the other component imports:

```typescript
import JournalListPage from "./components/JournalListPage";
```

2. In the `activeCanvasComponent` switch (after the Dashboard branch), add:

```tsx
{activeCanvasComponent === "Journal" && (
  <JournalListPage accountId={accountId} />
)}
```

3. In the fallback hamburger menu block (around line 175), add a Journal button:

```tsx
<button className="btn-secondary" onClick={() => { setActiveCanvasComponent("Journal"); setIsMenuOpen(false); }}>Journal</button>
```

- [ ] **Step 5: Verify TypeScript build**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/JournalComposer.tsx frontend/src/components/JournalListPage.tsx frontend/src/components/JournalEntryView.tsx frontend/src/App.tsx
git commit -m "feat(journal): add composer, list page, entry view, and nav item"
```

---

## Task 10: JournalProposalCard in AICoach Chat

**Files:**
- Create: `frontend/src/components/JournalProposalCard.tsx`
- Modify: `frontend/src/components/AICoach.tsx`

**Interfaces:**
- `JournalProposalCard` accepts `{ accountId, token, payload, onResolved, onEdit }` and renders Confirm / Edit / Discard buttons.
- When Confirm is clicked, call `confirmJournalEntry`, dispatch the entry into chat history, and call `onResolved(entry)`. Edit opens the `JournalComposer` pre-filled with `payload`. Discard closes the card.

- [ ] **Step 1: Implement `JournalProposalCard`**

Create `frontend/src/components/JournalProposalCard.tsx`:

```tsx
import { useState } from "react";
import { confirmJournalEntry, JournalEntry } from "../lib/api";
import JournalComposer from "./JournalComposer";

interface Props {
  accountId: string;
  token: string;
  payload: any;
  onResolved: (entry: JournalEntry) => void;
}

export default function JournalProposalCard({ accountId, token, payload, onResolved }: Props) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const entry = await confirmJournalEntry({ accountId, token });
    setBusy(false);
    onResolved(entry);
  };

  if (editing) {
    return (
      <JournalComposer
        accountId={accountId}
        initial={payload}
        onSaved={(entry) => onResolved(entry)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
      <strong>Journal entry proposed by AI coach</strong>
      <div style={{ fontWeight: 600 }}>{payload.title}</div>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", maxHeight: 200, overflow: "auto" }}>{payload.body}</pre>
      {payload.context_summary && <div><b>Context:</b> {payload.context_summary}</div>}
      {payload.lesson && <div><b>Lesson:</b> {payload.lesson}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" disabled={busy} onClick={confirm}>Confirm & save</button>
        <button className="btn-secondary" onClick={() => setEditing(true)}>Edit then save</button>
        <button className="btn-secondary" onClick={() => onResolved(null as any)}>Discard</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Hook it into `AICoach`**

In `frontend/src/components/AICoach.tsx`, find the block that parses widget tokens (e.g. `[WIDGET: …]`) and add a parallel handler for `[JOURNAL_PROPOSAL: …]`:

```tsx
if (text.startsWith("[JOURNAL_PROPOSAL:")) {
  const json = text.replace("[JOURNAL_PROPOSAL:", "").replace(/]$/, "").trim();
  const data = JSON.parse(json);
  return (
    <JournalProposalCard
      accountId={accountId}
      token={data.token}
      payload={data.payload}
      onResolved={(entry) => {
        if (entry) onCoachMessage(`📌 Saved journal entry: ${entry.title}`);
      }}
    />
  );
}
```

Add the import at the top:

```tsx
import JournalProposalCard from "./JournalProposalCard";
```

(Adapt the surrounding markup to match the existing AICoach message-rendering flow  Ekeep the styling consistent with existing widgets.)

- [ ] **Step 3: TypeScript build check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/JournalProposalCard.tsx frontend/src/components/AICoach.tsx
git commit -m "feat(journal): embed proposal confirm card in AI coach chat"
```

---

## Task 11: Feature Flag Wiring + Final Smoke Test

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Read feature flag on boot**

At the top of `server.ts`, near where other `process.env` reads live, add:

```typescript
const JOURNALING_ENABLED = process.env.ENABLE_JOURNALING !== "false";
```

- [ ] **Step 2: Gate the preview/confirm handlers when disabled**

In `backend/src/routes/journalCoach.ts`, guard the handler bodies so the flag gates the AI flow without blocking the manual form (which talks only to `/api/journal-entries`):

```typescript
export async function previewJournalEntryHandler(req: any, res: any) {
  if (process.env.ENABLE_JOURNALING === "false") return res.status(404).json({ error: "disabled" });
  // ... existing handler body
}
```

(The `ENABLE_JOURNALING` env is read directly here; the `JOURNALING_ENABLED` constant from Step 1 is used by the AI router in Task 7 to conditionally register the tool.)

- [ ] **Step 3: Run full backend test suite**

Run: `cd backend && npx jest`
Expected: All tests pass.

- [ ] **Step 4: Run frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no TS errors.

- [ ] **Step 5: Manual smoke test**

1. `cd backend && npm run dev`
2. `cd frontend && npm run dev`
3. Open the app.
4. In the AI coach, type: "I just held 2 MNQ overnight as the first trade after a month away. AMZN earnings looked strong and I expected a KOSPI relief bid."
5. The coach should respond and call `create_journal_entry`, surfacing the proposal card.
6. Click Confirm; expect a new entry under the Journal tab.

- [ ] **Step 6: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat(journal): gate AI coach tool behind ENABLE_JOURNALING flag"
```

---

## Self-Review

- Spec section 4 (data model): Tasks 1 and 2 cover all columns and tag junction.
- Spec section 5 (API surface): Tasks 5 and 6 expose all endpoints, including the preview token flow.
- Spec section 6 (AI Coach contract): Task 7 adds the tool definition, RAG, and switch handler.
- Spec section 7 (Frontend): Tasks 9 and 10 build the composer, list, view, and embedded proposal card. Nav item lands in `App.tsx`.
- Spec section 8 (Error handling): Task 7 wraps embedding in try/catch; Task 6 returns 409 for stale tokens; the manual form path is unaffected by LLM outage.
- Spec section 9 (Testing): Each backend task ships unit or integration tests; the frontend is verified with `tsc --noEmit` and a smoke test in Task 11.
- Spec section 10 (Rollout): Task 11 wires the `ENABLE_JOURNALING` env flag.

No placeholders remain; all method names (`embedJournalEntryBody`, `createPreview`, `confirmJournalEntry`, etc.) are defined in their owning task before use.
