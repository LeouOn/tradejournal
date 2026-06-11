# AI Coach Trade Grouping & Orphan Reconciliation

**Date:** 2026-06-11
**Status:** Design — awaiting user approval
**Author:** Sisyphus (with user)

## Two related features, one workstream

This spec covers two features that emerged from the same architectural shift: letting the AI Coach adjudicate judgment-heavy decisions about the user's trades via tool calls. Both replace rigid heuristic logic with LLM-driven discretion.

1. **Trade grouping**: today, `ironbeam/sync` dumps all fills from a statement into one OPEN trade per symbol. After today's 54-fill session was synced, the user has 1 trade row instead of 9, which kills the per-trade behavioral analytics. The coach should propose groupings, the user confirms.

2. **Orphan reconciliation**: today, the coach prompt *describes* orphans but provides no tool to resolve them. The user has 45+ orphans with no way to act on them through the coach. The LLM should decide drop/keep/ignore per orphan.

Both follow the same pattern: pure-function helper + new tool + endpoint + system-prompt update + TDD.

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
- [ ] Live test: paste yesterday's 22-fill statement into the analyzer, observe the 22 ghosts and 45 orphans in the response, type "reconcile my orphans" in the coach, observe the LLM call `reconcile_orphan` for each orphan, verify the DB changes

---

# Part 2: Coach-Driven Trade Grouping

## Problem (continued)

The current `ironbeam/sync` endpoint groups all fills from a single import into one `OPEN` Trade row per `(account_id, symbol)`. After syncing today's 54-fill statement, the user has 1 Trade row instead of the 9 flat-to-flat trades that the data actually contains. This destroys per-trade analytics: the user can't see "I had 9 trades, 7 winners, 2 losers" — they see "I had 1 trade, +$710."

The grouping decision is judgment-heavy:
- A scalper wants flat-to-flat: each completed round-trip is its own trade.
- A position flipper wants session-based: a long → short → long all might be "one trading idea" worth tracking together.
- A user might do 4 scalp-tries then a runner: should the runner be a separate trade or an extension of the scalps?

A fixed heuristic can't tell. The LLM coach can — with the user's playbook, recent chat, and regime as context.

## Goal

Give the AI Coach a `group_into_trades` tool. When the user pastes a statement and says "group these into trades" (or just "apply" after the coach proactively proposes a grouping), the coach reads the fills, decides how to group them, and calls the tool with the proposed groups. The user reviews and confirms. **Default behavior when the user clicks Sync without consulting the coach is flat-to-flat** (per user preference).

## Design

### 1. New tool: `group_into_trades`

```typescript
{
  type: "function" as const,
  function: {
    name: "group_into_trades",
    description: "Propose a grouping of broker fills into discrete trades. Use this when the user pastes a statement and asks you to organize the fills. Each trade must be flat-to-flat: net position starts at zero, scales in/out, and returns to zero. Call this once per grouping proposal, then the user reviews and confirms.",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "The account to create trades for" },
        proposal: {
          type: "array",
          description: "Proposed trade groupings, in chronological order",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string", description: "Base symbol (e.g. MNQ, NQ)" },
              bias: { type: "string", enum: ["LONG", "SHORT", "RANGE"] },
              executions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    side: { type: "string", enum: ["BUY", "SELL"] },
                    quantity: { type: "number" },
                    fill_price: { type: "number" },
                    execution_timestamp: { type: "string", description: "ISO timestamp" }
                  },
                  required: ["side", "quantity", "fill_price", "execution_timestamp"]
                }
              },
              notes: { type: "string", description: "Optional one-line rationale" }
            },
            required: ["symbol", "bias", "executions"]
          }
        }
      },
      required: ["account_id", "proposal"]
    }
  }
}
```

### 2. New helper: `applyTradeGrouping()`

File: `backend/src/services/tradeGrouping.ts`. Pure-ish function with one Prisma dependency.

```typescript
export interface TradeGroup {
  symbol: string;
  bias: "LONG" | "SHORT" | "RANGE";
  executions: Array<{
    side: "BUY" | "SELL";
    quantity: number;
    fill_price: number;
    execution_timestamp: string;
  }>;
  notes?: string;
}

export interface GroupingResult {
  tradesCreated: Array<{ tradeId: string; bias: string; netPnl: number }>;
  totalTrades: number;
}

export async function applyTradeGrouping(
  prisma: PrismaClient,
  accountId: string,
  groups: TradeGroup[]
): Promise<GroupingResult>
```

**Semantics per group:**

1. Compute net position from `executions` (BUY adds, SELL subtracts). If non-zero at the end, reject the group (the coach must produce flat-to-flat groups).
2. Compute bias from the first execution: first BUY → LONG, first SELL → SHORT.
3. Compute P&L: for LONG, `(sum of SELL fill_price × qty - sum of BUY fill_price × qty) × symbol_multiplier`; for SHORT, the inverse.
4. Create `Trade` row with `symbol`, `status: "CLOSED"`, `net_pnl`, `r_multiple: 0` (simplified for v1), `duration: 0`, `bias`, `manual_status: false`, `trade_type: "BREAKOUT"` (default), `account_id`, `created_at: first execution's timestamp`, `notes: groups[i].notes || "Auto-grouped by AI Coach"`.
5. Create `Execution` rows linked to the trade.
6. Create `MarketContext` row with the current regime state (consistent with `ironbeam/sync`).
7. Optionally tag the trade with "AI Coach Grouped" so the user can find them later.

**Symbol multiplier:** use `getSymbolMultiplier(symbol)` from `utils/multipliers`. The new helper that was fixed in Task 3 of the prior session.

### 3. New endpoint: `POST /api/trades/group`

```typescript
app.post("/api/trades/group", async (req, res) => {
  const { accountId, proposal } = req.body;
  if (!accountId || !Array.isArray(proposal)) {
    return res.status(400).json({ error: "accountId and proposal are required" });
  }
  try {
    const result = await applyTradeGrouping(prisma, accountId, proposal);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

### 4. Tool handler in `streamAICoach`

In `aiRouter.ts`, the tool-call execution block (around line 850, where `log_trade`, `record_observation`, and `reconcile_orphan` are handled) gets a new branch for `group_into_trades`. Same error-handling pattern as the other tools.

### 5. Default behavior change in `ironbeam/sync`

The current `ironbeam/sync` endpoint creates one `OPEN` trade per `(account_id, symbol)` and dumps all fills into it. This is the wrong default. The new default: **flat-to-flat grouping**.

Concretely, replace lines 1305-1335 (`// 2. Create unjournaled ghost executions`) with logic that:
1. Sorts ghosts by timestamp.
2. Groups them flat-to-flat (net position cycles to zero).
3. Creates one `Trade` per group with `status: "CLOSED"` (since the group is complete).
4. If the final net position is non-zero (a partial day), creates an `OPEN` trade with the remaining executions.

The new helper `applyTradeGrouping` can be reused: feed it the flat-to-flat groups from `ghosts` and call it.

This is a **behavior change** to an existing endpoint. Existing OPEN trades that resulted from the old single-trade-per-symbol behavior are not affected — they stay in the DB. Only NEW sync calls use the new logic.

### 6. System prompt update for grouping

Add to the AI Coach's system prompt (around line 693 in `aiRouter.ts`):

> 6. If the user pastes a statement and asks you to organize the fills, call `group_into_trades` with a proposed grouping. Use flat-to-flat grouping (each sequence of BUYs that net to zero with SELLs becomes its own trade). You may proactively suggest a grouping when the user pastes a large statement: "I see N fills from your statement. I'd group them into M trades. Want me to apply?"

## User Experience

```
You: [pastes 54-fill statement]

Coach: I see 54 fills from your statement. Looking at the price action, I'd group them into 9 trades:
       1. SHORT 11:40:48 → 11:46:19 ($+44.50)
       2. LONG 11:32:01 → 11:40:04 ($+365.50)
       3. LONG 11:06:56 → 11:31:10 ($-576.50)  ← the 29100 short that doubled down
       4. SHORT 10:34:45 → 10:41:57 ($+244.50)
       ... (5 more)
       
       Want me to apply this grouping?
       
       [tool: group_into_trades(account_id="...", proposal=[9 trade groups])]
       
You: yes

Coach: Done. Created 9 trades totaling +$710.00. You can see them in your dashboard.
```

If the user clicks "Sync" without asking the coach, the default behavior is flat-to-flat (no LLM call, no latency).

## Tests

### `backend/src/services/tradeGrouping.ts` (new)

- `applyTradeGrouping` with 1 group: creates Trade + Executions + MarketContext, returns correct netPnl
- `applyTradeGrouping` with 9 groups: creates 9 trades, each CLOSED, each with correct bias
- Rejects a group with non-zero net position (throws or returns error)
- Computes P&L correctly for LONG vs SHORT
- Uses `getSymbolMultiplier` for non-MNQ symbols (ES, NQ, etc.)
- Tags the trade with "AI Coach Grouped" if the grouping came from the coach (vs default sync)

### `backend/src/__tests__/tradeGrouping.test.ts` (new)

Mocked Prisma. At least 8 test cases.

### `backend/src/__tests__/tradesGroupEndpoint.test.ts` (new)

Integration test for the endpoint.

### `ironbeam/sync` behavior change

Existing integration test for `ironbeam/sync` should be updated (or new test added) that verifies the new flat-to-flat grouping behavior. At minimum: a test that pastes 9 fills and verifies 9 Trade rows are created with status CLOSED.

### Default behavior

The old behavior (one OPEN trade per symbol) is gone for new syncs. Document this in the spec acceptance criteria.

## Out of Scope (grouping)

- **Per-symbol session grouping** (the old behavior) is no longer a default. If a user wants it, they can ask the coach to override.
- **Re-grouping** existing trades (taking a 54-fill OPEN trade and splitting it into 9 CLOSED trades). This is a separate migration problem. Out of scope for v1.
- **LIFO matching within groups** (matching long entries to short exits by LIFO order). The current `applyLIFOMatching` exists for a different use case; grouping is by flat-to-flat, not by LIFO.
- **Group-by-time-window** (e.g., "if executions are >30 min apart, force a new group"). Pure flat-to-flat is the spec; time-window heuristics are a follow-up.

## Risk (grouping)

- **LLM proposes a bad grouping** (e.g., includes a non-flat-to-flat group). Mitigation: `applyTradeGrouping` validates each group's net position is zero. If invalid, it returns an error and the user can re-ask.
- **P&L calc mistakes** (e.g., wrong multiplier). Mitigation: the helper is pure and unit-tested; the LLM only proposes the grouping, it doesn't compute the P&L.
- **Race condition** if the user clicks Sync and the coach simultaneously. Mitigation: not actually a race; the sync and the coach are independent operations on the same fills. The user can sync first, then ask the coach to re-group (which will create *additional* trades, since the old ones aren't deleted). For v1 this is acceptable; the user can manually clean up.
- **Default behavior change** to `ironbeam/sync` could surprise users who relied on the old "one OPEN trade per symbol" behavior. Mitigation: document the change in the spec; mention it in the AI Coach's greeting; the orphan reconciliation tool is the migration path for users who want to clean up old OPEN trades.

## Acceptance Criteria (grouping)

- [ ] `applyTradeGrouping` helper passes all unit tests
- [ ] `POST /api/trades/group` endpoint works
- [ ] `group_into_trades` is in the coach's tool list
- [ ] Coach can read a 54-fill statement, propose 9 trades, and call `group_into_trades` to apply
- [ ] Default `ironbeam/sync` behavior is flat-to-flat (new behavior, replaces old single-trade-per-symbol)
- [ ] `getSymbolMultiplier` is used (no more hardcoded `* 2`)
- [ ] Live test: take today's 54 fills, paste into the coach, type "group these into trades", observe 9 Trade rows created with per-trade P&L matching the breakdown in this spec

## Implementation Plan

Combined with orphan reconciliation, this is now a 5-6 sub-agent workstream:

1. **Schema** (combine both features): add `is_reconciled`, `reconciled_at`, `reconcile_reason` to `Execution`; migrate
2. **Helper: `applyOrphanDecision`** with TDD
3. **Helper: `applyTradeGrouping`** with TDD (also fixes the hardcoded `* 2` if any remains)
4. **Endpoints**: `POST /api/orphans/reconcile` and `POST /api/trades/group`
5. **Tool wiring**: add `reconcile_orphan` and `group_into_trades` to the coach's tool list, add prompt update, **fix the missing `execution_id` in the prompt report**
6. **Default `ironbeam/sync` behavior change**: flat-to-flat grouping (replaces old single-trade-per-symbol)
7. **Final integration test** with the user's actual data: paste 54 fills, observe coach propose 9 trades, apply, verify DB
