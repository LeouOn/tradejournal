# AI Coach Orphan Reconciliation

**Date:** 2026-06-11
**Status:** Design — awaiting user approval
**Author:** Sisyphus (with user)

## Problem

The Ironbeam reconciliation analyzer (`POST /api/ingest/ironbeam/analyze`) classifies each broker fill as `matched`, `ghost`, or `orphan`. An **orphan** is a manual journal execution that has no matching broker fill — the user logged something that the broker says never happened.

Today, the analyzer surfaces 45+ orphans for a single trading day. The coach prompt *describes* orphans in the reconciliation report (line 697 of `aiRouter.ts`: *"Address Orphan Trades: Did they log a trade that never filled?"*) but provides **no tool to resolve them**. The user is told they have orphans but cannot act on them through the coach.

The orphan decision is inherently judgment-heavy:
- A BUY with no matching SELL could be an unclosed position (you forgot to log the close).
- A SELL with no preceding BUY could be a manifest that didn't fill, or a position inherited from a prior session.
- The 48-hour analyzer window and MNQ symbol-normalization gaps (in `server.ts:1147` and `server.ts:1193-1197`) cause false orphans that are not real reconciliation problems.

A heuristic matcher cannot make these calls. The LLM coach can — *if* it has a tool to apply decisions.

## Goal

Give the AI Coach a `reconcile_orphan` tool that lets it iteratively decide what to do with each orphan, with reasoning captured for audit. Trigger the flow via natural language ("reconcile my orphans", "go through the orphans", "what should I do about the 45 orphans?").

## Design

### 1. New tool: `reconcile_orphan`

Added to the `tools: [...]` array in `aiRouter.ts:775` alongside the existing five tools.

```typescript
{
  type: "function" as const,
  function: {
    name: "reconcile_orphan",
    description: "Record a decision on an orphan execution. Call this once per orphan after analyzing it. Use 'drop' if the broker is right and the journal entry is a manifest/error, 'keep' if the journal is right and the broker missed the fill, 'ignore' if you are uncertain and want to defer to the user. Always include a one-sentence reason — the user will see it.",
    parameters: {
      type: "object",
      properties: {
        execution_id: {
          type: "string",
          description: "UUID of the orphan execution row (from the reconciliation report)"
        },
        decision: {
          type: "string",
          enum: ["drop", "keep", "ignore"]
        },
        reason: {
          type: "string",
          description: "One-sentence rationale the user will see"
        }
      },
      required: ["execution_id", "decision", "reason"]
    }
  }
}
```

### 2. Schema change: extend `Execution`

Add to `Execution` in `backend/prisma/schema.prisma`:

```prisma
is_reconciled     Boolean  @default(false)
reconciled_at     DateTime?
reconcile_reason  String?
```

`is_reconciled` is the gate for "skip this orphan in future reconciliation reports". A nullable-then-NOT-NULL migration is not needed here — the column has a default, so it's safe to add as NOT NULL directly via `prisma db push`.

The existing `is_archived` column handles the soft-delete for `drop` decisions.

### 3. New helper: `applyOrphanDecision()`

File: `backend/src/services/orphanReconciliation.ts`. Pure-ish function with one Prisma dependency.

```typescript
export type OrphanDecision = "drop" | "keep" | "ignore";

export interface OrphanDecisionInput {
  accountId: string;
  executionId: string;
  decision: OrphanDecision;
  reason: string;
}

export interface OrphanDecisionResult {
  executionId: string;
  decision: OrphanDecision;
  applied: "dropped" | "kept" | "ignored";
  reason: string;
}

export async function applyOrphanDecision(
  prisma: PrismaClient,
  input: OrphanDecisionInput
): Promise<OrphanDecisionResult>
```

**Semantics:**

- **`drop`**: Update the execution to `is_archived: true, is_reconciled: true, reconcile_reason: reason, reconciled_at: now()`. The row stays in the DB but is filtered out of future reconciliation reports (which use `where: { is_archived: false }`).
- **`keep`**: Update the execution to `is_reconciled: true, reconcile_reason: reason, reconciled_at: now()`. Then append `\n[Orphan kept] ${reason}` to the parent trade's `notes` field. The trade's broker gap is now visible in trade detail.
- **`ignore`**: Update only `reconcile_reason: reason`. `is_reconciled` stays `false`, so the orphan remains an orphan in future reports. The reason is stored as a hint for the next reconciliation pass.

The function validates that the execution belongs to a trade under the given account (security check) and that the decision is one of the three enum values.

### 4. New endpoint: `POST /api/orphans/reconcile`

```typescript
app.post("/api/orphans/reconcile", async (req, res) => {
  const { accountId, executionId, decision, reason } = req.body;
  if (!accountId || !executionId || !decision || !reason) {
    return res.status(400).json({ error: "accountId, executionId, decision, reason are required" });
  }
  if (!["drop", "keep", "ignore"].includes(decision)) {
    return res.status(400).json({ error: "decision must be drop, keep, or ignore" });
  }
  try {
    const result = await applyOrphanDecision(prisma, { accountId, executionId, decision, reason });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

### 5. Tool handler in `streamAICoach`

In `aiRouter.ts`, the existing tool-call execution block (around lines 850-900, where `log_trade` and `record_observation` are handled) gets a new branch:

```typescript
if (toolCall.name === "reconcile_orphan" && toolCall.arguments) {
  try {
    const args = JSON.parse(toolCall.arguments);
    const res = await fetch(`http://localhost:5000/api/orphans/reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        executionId: args.execution_id,
        decision: args.decision,
        reason: args.reason,
      }),
    });
    const result = await res.json();
    const summary = `\n\n✅ **Orphan ${result.applied}** — ${args.execution_id.substring(0, 8)}: ${args.reason}`;
    fullText += summary;
    onToken(summary);
  } catch (err: any) {
    const msg = `\n\n❌ **Failed to reconcile orphan:** ${err.message}`;
    fullText += msg;
    onToken(msg);
  }
}
```

The same error-handling pattern as `log_trade` (per the existing convention).

### 6. **Critical fix**: include `execution_id` in the reconciliation report

The current prompt serialization at `aiRouter.ts:619-626` does not include `execution_id` in the orphan text. Without it, the LLM cannot reference which orphan it's deciding on.

```typescript
// Before:
orphanText = report.orphans.map((o: any) => 
  `- Symbol: ${o.symbol} | Side: ${o.side} | Qty: ${o.quantity} | Price: ${o.fill_price} | Time: ${...}`
).join("\n");

// After:
orphanText = report.orphans.map((o: any) => 
  `- ID: ${o.execution_id} | Symbol: ${o.symbol} | Side: ${o.side} | Qty: ${o.quantity} | Price: ${o.fill_price} | Time: ${o.execution_timestamp ? new Date(o.execution_timestamp).toLocaleTimeString() : 'N/A'}`
).join("\n");
```

Same change for the `ghosts` block (line 611-616) — even though the spec doesn't add a `reconcile_ghost` tool yet, including the `statement`-side identifier (a synthesized one based on order ID) future-proofs the prompt.

### 7. System prompt update

The reconciliation section in `aiRouter.ts` (around line 693) gets a new behavior block:

> 5. If the user asks you to reconcile orphans (e.g., "reconcile my orphans", "go through the orphans", "what should I do about the 45 orphans?"):
>    - Iterate through each orphan in the report
>    - For each, call `reconcile_orphan` with one decision: `drop` (manifest/false positive), `keep` (broker missed a real fill), or `ignore` (genuinely ambiguous, defer to user)
>    - Always include a one-sentence `reason` — the user sees it
>    - Be opinionated: prefer `drop` or `keep` when you have reasonable evidence; reserve `ignore` for cases where the price action and trade history are both unclear
>    - You may make multiple tool calls in parallel (the runtime streams them)
>    - If there are more than ~20 orphans, briefly acknowledge the scope and consider doing them in batches of 10 with a one-line progress note between batches

## User Experience

```
You: reconcile my orphans

Coach: I see 45 orphans in your latest reconciliation. Let me go through them.
       [tool: reconcile_orphan(execution_id="4aab043e-...", decision="drop",
                               reason="Price action at 29598 shows a manifest that
                                       never filled — the BUY at 29594.75 was the
                                       entry and SELL at 29596 was the close; the
                                       29598.75 SELL has no matching BUY.")]
       [tool: reconcile_orphan(execution_id="e9f6ddd6-...", decision="drop", reason="...")]
       ... (continues in parallel)
       
       [after first ~8] Processed 8 of 45 orphans so far: 6 dropped, 2 kept.
       
       ... (continues)
       
       [after 45] Done. Summary: 32 dropped, 11 kept, 2 ignored. The 11 kept
                  ones are visible in the trade notes; the 32 dropped ones
                  are hidden from future reconciliation reports.
```

If the user disagrees with a decision: *"undo that last one"* triggers a future `revert_orphan` tool (out of scope for this spec — leave as a follow-up).

## Tests

TDD-first, as per the project's test discipline.

### `backend/src/services/orphanReconciliation.ts` (new)

- `applyOrphanDecision` for `drop`: execution row gets `is_archived: true, is_reconciled: true, reconcile_reason, reconciled_at`. No change to trade.notes.
- `applyOrphanDecision` for `keep`: execution row gets `is_reconciled: true, reconcile_reason, reconciled_at`. Trade.notes has `[Orphan kept] <reason>` appended.
- `applyOrphanDecision` for `ignore`: execution row gets only `reconcile_reason` set. `is_reconciled` stays `false`.
- Security check: passing an `executionId` from a different account throws.
- Invalid decision value throws.

### `backend/src/__tests__/orphanReconciliation.test.ts` (new)

Mocked Prisma. Tests for each of the 3 decision paths. At least 8 test cases.

### `backend/src/__tests__/ironbeamReconciliationPrompt.test.ts` (new)

Verify the prompt serialization includes `execution_id` in the orphan and ghost lines.

### Tool wiring smoke test

`backend/src/__tests__/aiRouter.test.ts` (new) — verify `reconcile_orphan` is in the `tools: [...]` array, has a valid schema (3 properties, 3 required, 3 enum values for decision).

### `backend/src/__tests__/orphansReconcileEndpoint.test.ts` (new)

Integration test for the endpoint:
- 400 on missing fields
- 400 on invalid decision
- 200 + correct result for each of the 3 decisions
- 500 (or 404) on unknown executionId

## Out of Scope

- **Heuristic matcher improvements** (48-hour window, MNQ symbol normalization in the analyzer). These are real bugs but separate from the reconciliation tool. They will reduce the orphan count but never eliminate it — the LLM tool is still needed.
- **Bulk reverse / revert** (a `revert_orphan` tool). The user can fix mistakes by editing the chat and saying "undo the last one" — but the actual tool to do that is a follow-up. For now, the user can fix a wrong decision by directly editing the DB or by calling a manual API. (Acceptable for v1.)
- **Ghost reconciliation** (the inverse — broker has a fill, journal doesn't). The current `ironbeam/sync` endpoint handles ghosts at import time, but a `reconcile_ghost` tool for post-hoc review is a follow-up.
- **Per-orphan LLM cost controls** (token budgets, parallel-call limits). The LLM runtime will stream whatever it emits. If the user has 500 orphans one day, they'll wait a while. Acceptable for v1.
- **Auto-triggering** the reconciliation. The user must invoke via natural language. No background jobs.

## Risk

- **LLM makes a wrong decision.** Mitigation: every decision is auditable via `reconcile_reason` on the execution row. The user can see all decisions in the chat history. Wrong decisions can be manually reversed.
- **`execution_id` collisions** if two accounts have the same UUID. Mitigation: Prisma UUIDs are globally unique; collisions are vanishingly improbable. The `applyOrphanDecision` security check (line 3 in tests) also rejects cross-account access.
- **Large reconciliation reports** (500+ orphans) produce huge LLM prompts. Mitigation: the analyzer's 48-hour window naturally limits the report size in practice. If a user does have 500 orphans, the prompt size will be the bottleneck, not the tool.
- **No confirmation gate** means a bad LLM decision is applied immediately. The user can correct via follow-up chat or DB edit, but cannot "preview before commit". This is a deliberate trade-off per the user's preference: "No confirmation — LLM decisions apply immediately."

## Acceptance Criteria

- [ ] User can type "reconcile my orphans" in the AI Coach and get a streamed response that calls `reconcile_orphan` for each orphan
- [ ] Each tool call applies the correct DB change (drop/keep/ignore) per the spec
- [ ] `reconcile_reason` is stored on every decision
- [ ] `is_archived: true` executions are filtered out of future reconciliation reports
- [ ] Trade notes are updated for `keep` decisions
- [ ] All 89 baseline backend tests still pass
- [ ] At least 8 new tests for `applyOrphanDecision` and the endpoint
- [ ] The reconciliation report in the prompt includes `execution_id` for every orphan
- [ ] `prisma db push` succeeds with the new columns
- [ ] Live test: run the analyzer on yesterday's 22 fills + 45 orphans, paste the report into the coach, type "reconcile my orphans", observe the LLM call `reconcile_orphan` for each orphan, verify the DB changes

## Implementation Plan

Implementation will be dispatched via the `writing-plans` skill (next step), then executed via sub-agents with TDD discipline. Estimated 3-4 sub-agent tasks: schema+helper, endpoint, tool+prompt update, integration test.
