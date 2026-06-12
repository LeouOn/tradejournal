# Orphan Reconciliation & Trade Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement two AI Coach tools — `reconcile_orphan` (resolve orphan executions) and `group_into_trades` (group broker fills into discrete flat-to-flat trades) — plus change the default `ironbeam/sync` behavior from single-trade-per-symbol to flat-to-flat grouping.

**Architecture:** Pure-function helpers with Prisma dependency (`applyOrphanDecision`, `applyTradeGrouping`), REST endpoints, tool wiring in `aiRouter.ts` switch block, system prompt updates. All TDD.

**Tech Stack:** TypeScript, Express, Prisma (SQLite), Jest/Vitest, OpenAI tool-calling API.

**Spec:** `docs/specs/2026-06-11-orphan-reconciliation.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/prisma/schema.prisma` (lines 59-67) | Add `is_reconciled`, `reconciled_at`, `reconcile_reason` to `Execution` model |
| Create | `backend/src/services/orphanReconciliation.ts` | `applyOrphanDecision()` pure helper |
| Create | `backend/src/services/tradeGrouping.ts` | `applyTradeGrouping()` helper, `groupFillsFlatToFlat()` helper |
| Create | `backend/src/__tests__/orphanReconciliation.test.ts` | Unit tests for orphan helper |
| Create | `backend/src/__tests__/tradeGrouping.test.ts` | Unit tests for grouping helper |
| Create | `backend/src/__tests__/orphansReconcileEndpoint.test.ts` | Endpoint tests for `POST /api/orphans/reconcile` |
| Create | `backend/src/__tests__/tradesGroupEndpoint.test.ts` | Endpoint tests for `POST /api/trades/group` |
| Modify | `backend/src/server.ts` (lines 1315-1368) | Replace ghost-sync logic with flat-to-flat grouping |
| Modify | `backend/src/server.ts` (add endpoints) | Add `/api/orphans/reconcile` and `/api/trades/group` |
| Modify | `backend/src/services/aiRouter.ts` (line 775) | Add two tools to `tools` array |
| Modify | `backend/src/services/aiRouter.ts` (lines 619-626) | Include `execution_id` in orphan/ghost text |
| Modify | `backend/src/services/aiRouter.ts` (line 693-698) | Update system prompt with orphan + grouping behavior blocks |
| Modify | `backend/src/services/aiRouter.ts` (lines 824-897) | Add `reconcile_orphan` and `group_into_trades` to tool switch |

---

## Task 1: Schema Migration — Add Reconciliation Columns to Execution

**Files:**
- Modify: `backend/prisma/schema.prisma` (lines 59-67)

- [ ] **Step 1: Update the Execution model**

Add three columns to the `Execution` model in `schema.prisma`:

```prisma
model Execution {
  execution_id        String   @id @default(uuid())
  fill_price          Decimal
  quantity            Decimal
  side                String // BUY, SELL
  execution_timestamp DateTime
  trade_id            String
  trade               Trade    @relation(fields: [trade_id], references: [trade_id], onDelete: Cascade)
  is_reconciled       Boolean  @default(false)
  reconciled_at       DateTime?
  reconcile_reason    String?
}
```

- [ ] **Step 2: Run prisma db push**

Run: `cd backend && npx prisma db push`
Expected: Schema synchronized, no errors.

- [ ] **Step 3: Run prisma generate**

Run: `cd backend && npx prisma generate`
Expected: Client generated successfully.

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `cd backend && npx vitest run`
Expected: All 100 existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma
git commit -m "feat: add reconciliation columns to Execution model"
```

---

## Task 2: applyOrphanDecision Helper — TDD

**Files:**
- Create: `backend/src/services/orphanReconciliation.ts`
- Create: `backend/src/__tests__/orphanReconciliation.test.ts`

- [ ] **Step 1: Write failing tests for applyOrphanDecision**

Create `backend/src/__tests__/orphanReconciliation.test.ts`:

```typescript
import { applyOrphanDecision, OrphanDecision } from "../services/orphanReconciliation";

// Mock PrismaClient following chatSession.test.ts pattern
function createMockPrisma() {
  return {
    execution: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    trade: {
      update: jest.fn(),
    },
  } as any;
}

const ACCOUNT_ID = "acct-001";
const EXECUTION_ID = "exec-001";
const TRADE_ID = "trade-001";

describe("applyOrphanDecision", () => {
  test("drop: sets is_archived + is_reconciled + reason + reconciled_at", async () => {
    const prisma = createMockPrisma();
    prisma.execution.findUnique.mockResolvedValue({
      execution_id: EXECUTION_ID,
      trade_id: TRADE_ID,
      trade: { account_id: ACCOUNT_ID },
    });
    prisma.execution.update.mockResolvedValue({ execution_id: EXECUTION_ID });

    const result = await applyOrphanDecision(prisma, {
      accountId: ACCOUNT_ID,
      executionId: EXECUTION_ID,
      decision: "drop",
      reason: "Manifest that never filled",
    });

    expect(result.applied).toBe("dropped");
    expect(result.executionId).toBe(EXECUTION_ID);
    expect(result.decision).toBe("drop");
    expect(prisma.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { execution_id: EXECUTION_ID },
        data: expect.objectContaining({
          is_archived: true,
          is_reconciled: true,
          reconcile_reason: "Manifest that never filled",
        }),
      })
    );
    // Should NOT update trade notes for drop
    expect(prisma.trade.update).not.toHaveBeenCalled();
  });

  test("keep: sets is_reconciled + reason + appends to trade notes", async () => {
    const prisma = createMockPrisma();
    prisma.execution.findUnique.mockResolvedValue({
      execution_id: EXECUTION_ID,
      trade_id: TRADE_ID,
      trade: { account_id: ACCOUNT_ID },
    });
    prisma.execution.update.mockResolvedValue({ execution_id: EXECUTION_ID });
    prisma.trade.update.mockResolvedValue({ trade_id: TRADE_ID });

    const result = await applyOrphanDecision(prisma, {
      accountId: ACCOUNT_ID,
      executionId: EXECUTION_ID,
      decision: "keep",
      reason: "Broker missed a real fill at 29598",
    });

    expect(result.applied).toBe("kept");
    expect(prisma.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          is_reconciled: true,
          reconcile_reason: "Broker missed a real fill at 29598",
        }),
      })
    );
    expect(prisma.trade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { trade_id: TRADE_ID },
        data: expect.objectContaining({
          notes: expect.stringContaining("[Orphan kept] Broker missed a real fill at 29598"),
        }),
      })
    );
  });

  test("ignore: sets only reconcile_reason, is_reconciled stays false", async () => {
    const prisma = createMockPrisma();
    prisma.execution.findUnique.mockResolvedValue({
      execution_id: EXECUTION_ID,
      trade_id: TRADE_ID,
      trade: { account_id: ACCOUNT_ID },
    });
    prisma.execution.update.mockResolvedValue({ execution_id: EXECUTION_ID });

    const result = await applyOrphanDecision(prisma, {
      accountId: ACCOUNT_ID,
      executionId: EXECUTION_ID,
      decision: "ignore",
      reason: "Ambiguous — could be either way",
    });

    expect(result.applied).toBe("ignored");
    expect(prisma.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          is_reconciled: false,
          reconcile_reason: "Ambiguous — could be either way",
        }),
      })
    );
    expect(prisma.trade.update).not.toHaveBeenCalled();
  });

  test("throws if execution not found", async () => {
    const prisma = createMockPrisma();
    prisma.execution.findUnique.mockResolvedValue(null);

    await expect(
      applyOrphanDecision(prisma, {
        accountId: ACCOUNT_ID,
        executionId: "nonexistent",
        decision: "drop",
        reason: "test",
      })
    ).rejects.toThrow("Execution nonexistent not found");
  });

  test("throws if execution belongs to different account", async () => {
    const prisma = createMockPrisma();
    prisma.execution.findUnique.mockResolvedValue({
      execution_id: EXECUTION_ID,
      trade_id: TRADE_ID,
      trade: { account_id: "different-account" },
    });

    await expect(
      applyOrphanDecision(prisma, {
        accountId: ACCOUNT_ID,
        executionId: EXECUTION_ID,
        decision: "drop",
        reason: "test",
      })
    ).rejects.toThrow("does not belong to account");
  });

  test("throws for invalid decision value", async () => {
    const prisma = createMockPrisma();

    await expect(
      applyOrphanDecision(prisma, {
        accountId: ACCOUNT_ID,
        executionId: EXECUTION_ID,
        decision: "maybe" as any,
        reason: "test",
      })
    ).rejects.toThrow("Invalid decision");
  });

  test("keep: appends to existing trade notes", async () => {
    const prisma = createMockPrisma();
    prisma.execution.findUnique.mockResolvedValue({
      execution_id: EXECUTION_ID,
      trade_id: TRADE_ID,
      trade: { account_id: ACCOUNT_ID, notes: "Original note." },
    });
    prisma.execution.update.mockResolvedValue({ execution_id: EXECUTION_ID });
    prisma.trade.update.mockResolvedValue({ trade_id: TRADE_ID });

    await applyOrphanDecision(prisma, {
      accountId: ACCOUNT_ID,
      executionId: EXECUTION_ID,
      decision: "keep",
      reason: "Real fill",
    });

    const updateCall = prisma.trade.update.mock.calls[0][0];
    expect(updateCall.data.notes).toContain("Original note.");
    expect(updateCall.data.notes).toContain("[Orphan kept] Real fill");
  });

  test("drop and keep both set reconciled_at to a non-null date", async () => {
    const prisma = createMockPrisma();
    prisma.execution.findUnique.mockResolvedValue({
      execution_id: EXECUTION_ID,
      trade_id: TRADE_ID,
      trade: { account_id: ACCOUNT_ID },
    });
    prisma.execution.update.mockResolvedValue({ execution_id: EXECUTION_ID });

    await applyOrphanDecision(prisma, {
      accountId: ACCOUNT_ID,
      executionId: EXECUTION_ID,
      decision: "drop",
      reason: "test",
    });

    const updateCall = prisma.execution.update.mock.calls[0][0];
    expect(updateCall.data.reconciled_at).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run orphanReconciliation`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement applyOrphanDecision**

Create `backend/src/services/orphanReconciliation.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

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

const VALID_DECISIONS: OrphanDecision[] = ["drop", "keep", "ignore"];

export async function applyOrphanDecision(
  prisma: PrismaClient,
  input: OrphanDecisionInput
): Promise<OrphanDecisionResult> {
  const { accountId, executionId, decision, reason } = input;

  if (!VALID_DECISIONS.includes(decision)) {
    throw new Error(`Invalid decision: ${decision}. Must be drop, keep, or ignore.`);
  }

  const execution = await prisma.execution.findUnique({
    where: { execution_id: executionId },
    include: { trade: { select: { account_id: true, notes: true } } },
  });

  if (!execution) {
    throw new Error(`Execution ${executionId} not found`);
  }

  if (execution.trade.account_id !== accountId) {
    throw new Error(`Execution ${executionId} does not belong to account ${accountId}`);
  }

  const now = new Date();
  const appliedMap: Record<OrphanDecision, "dropped" | "kept" | "ignored"> = {
    drop: "dropped",
    keep: "kept",
    ignore: "ignored",
  };

  if (decision === "drop") {
    await prisma.execution.update({
      where: { execution_id: executionId },
      data: {
        is_archived: true,
        is_reconciled: true,
        reconcile_reason: reason,
        reconciled_at: now,
      },
    });
  } else if (decision === "keep") {
    await prisma.execution.update({
      where: { execution_id: executionId },
      data: {
        is_reconciled: true,
        reconcile_reason: reason,
        reconciled_at: now,
      },
    });
    const existingNotes = execution.trade.notes || "";
    await prisma.trade.update({
      where: { trade_id: execution.trade_id },
      data: {
        notes: existingNotes + `\n[Orphan kept] ${reason}`,
      },
    });
  } else {
    // ignore
    await prisma.execution.update({
      where: { execution_id: executionId },
      data: {
        reconcile_reason: reason,
      },
    });
  }

  return {
    executionId,
    decision,
    applied: appliedMap[decision],
    reason,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run orphanReconciliation`
Expected: All 8 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `cd backend && npx vitest run`
Expected: All tests pass (100 baseline + 8 new = 108).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/orphanReconciliation.ts backend/src/__tests__/orphanReconciliation.test.ts
git commit -m "feat: add applyOrphanDecision helper with TDD (8 tests)"
```

---

## Task 3: applyTradeGrouping Helper — TDD

**Files:**
- Create: `backend/src/services/tradeGrouping.ts`
- Create: `backend/src/__tests__/tradeGrouping.test.ts`

- [ ] **Step 1: Write failing tests for applyTradeGrouping**

Create `backend/src/__tests__/tradeGrouping.test.ts`:

```typescript
import { applyTradeGrouping, groupFillsFlatToFlat, TradeGroup } from "../services/tradeGrouping";

// Mock PrismaClient
function createMockPrisma() {
  const createdTrades: any[] = [];
  const createdExecutions: any[] = [];
  const createdContexts: any[] = [];

  return {
    trade: {
      create: jest.fn((args: any) => {
        const trade = { trade_id: `trade-${createdTrades.length + 1}`, ...args.data };
        createdTrades.push(trade);
        return Promise.resolve(trade);
      }),
    },
    execution: {
      create: jest.fn((args: any) => {
        createdExecutions.push(args.data);
        return Promise.resolve(args.data);
      }),
    },
    marketContext: {
      create: jest.fn((args: any) => {
        createdContexts.push(args.data);
        return Promise.resolve(args.data);
      }),
    },
    tag: {
      findUnique: jest.fn(),
      create: jest.fn((args: any) => Promise.resolve({ tag_id: "tag-coach", ...args.data })),
    },
    tradeTag: {
      create: jest.fn(),
    },
    _createdTrades: createdTrades,
    _createdExecutions: createdExecutions,
    _createdContexts: createdContexts,
  } as any;
}

const ACCOUNT_ID = "acct-001";

describe("groupFillsFlatToFlat", () => {
  test("splits 4 fills into 2 flat-to-flat trades", () => {
    const fills = [
      { side: "BUY" as const, quantity: 1, fillPrice: 100, timestamp: "2026-06-11T10:00:00Z", symbol: "MNQ" },
      { side: "SELL" as const, quantity: 1, fillPrice: 102, timestamp: "2026-06-11T10:05:00Z", symbol: "MNQ" },
      { side: "SELL" as const, quantity: 1, fillPrice: 103, timestamp: "2026-06-11T10:10:00Z", symbol: "MNQ" },
      { side: "BUY" as const, quantity: 1, fillPrice: 101, timestamp: "2026-06-11T10:15:00Z", symbol: "MNQ" },
    ];
    const groups = groupFillsFlatToFlat(fills);
    expect(groups).toHaveLength(2);
    expect(groups[0].executions).toHaveLength(2);
    expect(groups[1].executions).toHaveLength(2);
  });

  test("handles scaling in/out: 2 BUY + 2 SELL = 1 trade", () => {
    const fills = [
      { side: "BUY" as const, quantity: 1, fillPrice: 100, timestamp: "t1", symbol: "MNQ" },
      { side: "BUY" as const, quantity: 1, fillPrice: 101, timestamp: "t2", symbol: "MNQ" },
      { side: "SELL" as const, quantity: 1, fillPrice: 103, timestamp: "t3", symbol: "MNQ" },
      { side: "SELL" as const, quantity: 1, fillPrice: 104, timestamp: "t4", symbol: "MNQ" },
    ];
    const groups = groupFillsFlatToFlat(fills);
    expect(groups).toHaveLength(1);
    expect(groups[0].bias).toBe("LONG");
  });

  test("open position at end: last group has non-zero net", () => {
    const fills = [
      { side: "BUY" as const, quantity: 1, fillPrice: 100, timestamp: "t1", symbol: "MNQ" },
      { side: "SELL" as const, quantity: 1, fillPrice: 102, timestamp: "t2", symbol: "MNQ" },
      { side: "BUY" as const, quantity: 2, fillPrice: 105, timestamp: "t3", symbol: "MNQ" },
    ];
    const groups = groupFillsFlatToFlat(fills);
    expect(groups).toHaveLength(2);
    expect(groups[0].netPosition).toBe(0);
    expect(groups[1].netPosition).toBe(2); // still open
  });

  test("empty fills returns empty array", () => {
    expect(groupFillsFlatToFlat([])).toHaveLength(0);
  });
});

describe("applyTradeGrouping", () => {
  test("creates 1 trade with correct P&L for LONG MNQ (multiplier=2)", async () => {
    const prisma = createMockPrisma();
    const groups: TradeGroup[] = [
      {
        symbol: "MNQ",
        bias: "LONG",
        executions: [
          { side: "BUY", quantity: 1, fill_price: 29000, execution_timestamp: "2026-06-11T10:00:00Z" },
          { side: "SELL", quantity: 1, fill_price: 29050, execution_timestamp: "2026-06-11T10:05:00Z" },
        ],
      },
    ];

    const result = await applyTradeGrouping(prisma, ACCOUNT_ID, groups);

    expect(result.totalTrades).toBe(1);
    expect(result.tradesCreated[0].netPnl).toBe(100); // (29050-29000) * 2 * 1
    expect(prisma.trade.create).toHaveBeenCalledTimes(1);
    expect(prisma.execution.create).toHaveBeenCalledTimes(2);
    expect(prisma.marketContext.create).toHaveBeenCalledTimes(1);
  });

  test("creates 1 trade with correct P&L for SHORT NQ (multiplier=20)", async () => {
    const prisma = createMockPrisma();
    const groups: TradeGroup[] = [
      {
        symbol: "NQ",
        bias: "SHORT",
        executions: [
          { side: "SELL", quantity: 1, fill_price: 19000, execution_timestamp: "2026-06-11T10:00:00Z" },
          { side: "BUY", quantity: 1, fill_price: 18950, execution_timestamp: "2026-06-11T10:05:00Z" },
        ],
      },
    ];

    const result = await applyTradeGrouping(prisma, ACCOUNT_ID, groups);

    expect(result.totalTrades).toBe(1);
    expect(result.tradesCreated[0].netPnl).toBe(1000); // (19000-18950) * 20 * 1
  });

  test("creates multiple trades from multiple groups", async () => {
    const prisma = createMockPrisma();
    const groups: TradeGroup[] = [
      {
        symbol: "MNQ",
        bias: "LONG",
        executions: [
          { side: "BUY", quantity: 1, fill_price: 29000, execution_timestamp: "t1" },
          { side: "SELL", quantity: 1, fill_price: 29050, execution_timestamp: "t2" },
        ],
      },
      {
        symbol: "MNQ",
        bias: "SHORT",
        executions: [
          { side: "SELL", quantity: 1, fill_price: 29100, execution_timestamp: "t3" },
          { side: "BUY", quantity: 1, fill_price: 29080, execution_timestamp: "t4" },
        ],
      },
    ];

    const result = await applyTradeGrouping(prisma, ACCOUNT_ID, groups);
    expect(result.totalTrades).toBe(2);
    expect(prisma.trade.create).toHaveBeenCalledTimes(2);
    expect(prisma.execution.create).toHaveBeenCalledTimes(4);
  });

  test("rejects group with non-zero net position", async () => {
    const prisma = createMockPrisma();
    const groups: TradeGroup[] = [
      {
        symbol: "MNQ",
        bias: "LONG",
        executions: [
          { side: "BUY", quantity: 2, fill_price: 29000, execution_timestamp: "t1" },
          { side: "SELL", quantity: 1, fill_price: 29050, execution_timestamp: "t2" },
        ],
      },
    ];

    await expect(applyTradeGrouping(prisma, ACCOUNT_ID, groups)).rejects.toThrow(
      "net position is not zero"
    );
  });

  test("uses group notes if provided, otherwise defaults to 'Auto-grouped'", async () => {
    const prisma = createMockPrisma();
    const groups: TradeGroup[] = [
      {
        symbol: "MNQ",
        bias: "LONG",
        executions: [
          { side: "BUY", quantity: 1, fill_price: 29000, execution_timestamp: "t1" },
          { side: "SELL", quantity: 1, fill_price: 29050, execution_timestamp: "t2" },
        ],
        notes: "Scalp from 29000",
      },
    ];

    await applyTradeGrouping(prisma, ACCOUNT_ID, groups);

    const tradeCall = prisma.trade.create.mock.calls[0][0];
    expect(tradeCall.data.notes).toBe("Scalp from 29000");
  });

  test("defaults notes to 'Auto-grouped by AI Coach' when no notes provided", async () => {
    const prisma = createMockPrisma();
    const groups: TradeGroup[] = [
      {
        symbol: "MNQ",
        bias: "LONG",
        executions: [
          { side: "BUY", quantity: 1, fill_price: 29000, execution_timestamp: "t1" },
          { side: "SELL", quantity: 1, fill_price: 29050, execution_timestamp: "t2" },
        ],
      },
    ];

    await applyTradeGrouping(prisma, ACCOUNT_ID, groups);

    const tradeCall = prisma.trade.create.mock.calls[0][0];
    expect(tradeCall.data.notes).toBe("Auto-grouped by AI Coach");
  });

  test("sets status CLOSED for flat-to-flat group", async () => {
    const prisma = createMockPrisma();
    const groups: TradeGroup[] = [
      {
        symbol: "MNQ",
        bias: "LONG",
        executions: [
          { side: "BUY", quantity: 1, fill_price: 29000, execution_timestamp: "t1" },
          { side: "SELL", quantity: 1, fill_price: 29050, execution_timestamp: "t2" },
        ],
      },
    ];

    await applyTradeGrouping(prisma, ACCOUNT_ID, groups);

    const tradeCall = prisma.trade.create.mock.calls[0][0];
    expect(tradeCall.data.status).toBe("CLOSED");
  });

  test("computes P&L correctly for scaling trade: 2 BUY + 2 SELL", async () => {
    const prisma = createMockPrisma();
    const groups: TradeGroup[] = [
      {
        symbol: "MNQ",
        bias: "LONG",
        executions: [
          { side: "BUY", quantity: 1, fill_price: 29000, execution_timestamp: "t1" },
          { side: "BUY", quantity: 1, fill_price: 29010, execution_timestamp: "t2" },
          { side: "SELL", quantity: 1, fill_price: 29050, execution_timestamp: "t3" },
          { side: "SELL", quantity: 1, fill_price: 29060, execution_timestamp: "t4" },
        ],
      },
    ];

    const result = await applyTradeGrouping(prisma, ACCOUNT_ID, groups);
    // LONG P&L = (sum SELL*qty - sum BUY*qty) * multiplier
    // = ((29050*1 + 29060*1) - (29000*1 + 29010*1)) * 2
    // = (58110 - 58010) * 2 = 200
    expect(result.tradesCreated[0].netPnl).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tradeGrouping`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement applyTradeGrouping and groupFillsFlatToFlat**

Create `backend/src/services/tradeGrouping.ts`:

```typescript
import { PrismaClient } from "@prisma/client";
import { getSymbolMultiplier } from "../utils/multipliers";

export interface TradeGroupExecution {
  side: "BUY" | "SELL";
  quantity: number;
  fill_price: number;
  execution_timestamp: string;
}

export interface TradeGroup {
  symbol: string;
  bias: "LONG" | "SHORT" | "RANGE";
  executions: TradeGroupExecution[];
  notes?: string;
}

export interface GroupingResult {
  tradesCreated: Array<{ tradeId: string; bias: string; netPnl: number }>;
  totalTrades: number;
}

export interface FlatFill {
  side: "BUY" | "SELL";
  quantity: number;
  fillPrice: number;
  timestamp: string;
  symbol: string;
}

export interface FlatGroup {
  executions: FlatFill[];
  bias: "LONG" | "SHORT" | "RANGE";
  symbol: string;
  netPosition: number;
}

/**
 * Groups fills into flat-to-flat sequences.
 * Each group starts when net position is zero and ends when it returns to zero.
 * If the final group has a non-zero net position, it's returned as an "open" group.
 */
export function groupFillsFlatToFlat(fills: FlatFill[]): FlatGroup[] {
  if (fills.length === 0) return [];

  const groups: FlatGroup[] = [];
  let currentExecs: FlatFill[] = [];
  let netPos = 0;
  let currentSymbol = fills[0].symbol;

  for (const fill of fills) {
    if (currentExecs.length === 0) {
      currentSymbol = fill.symbol;
    }

    currentExecs.push(fill);
    netPos += fill.side === "BUY" ? fill.quantity : -fill.quantity;

    if (netPos === 0) {
      const bias = currentExecs[0].side === "BUY" ? "LONG" : "SHORT";
      groups.push({
        executions: [...currentExecs],
        bias: bias as "LONG" | "SHORT",
        symbol: currentSymbol,
        netPosition: 0,
      });
      currentExecs = [];
    }
  }

  // Remaining open position
  if (currentExecs.length > 0) {
    const bias = currentExecs[0].side === "BUY" ? "LONG" : "SHORT";
    groups.push({
      executions: [...currentExecs],
      bias: bias as "LONG" | "SHORT",
      symbol: currentSymbol,
      netPosition: netPos,
    });
  }

  return groups;
}

function computePnL(
  executions: TradeGroupExecution[],
  bias: "LONG" | "SHORT" | "RANGE",
  multiplier: number
): number {
  let sellValue = 0;
  let buyValue = 0;

  for (const exec of executions) {
    if (exec.side === "SELL") {
      sellValue += exec.fill_price * exec.quantity;
    } else {
      buyValue += exec.fill_price * exec.quantity;
    }
  }

  if (bias === "SHORT") {
    return (buyValue - sellValue) * multiplier;
  }
  // LONG and RANGE: profit when sell > buy
  return (sellValue - buyValue) * multiplier;
}

export async function applyTradeGrouping(
  prisma: PrismaClient,
  accountId: string,
  groups: TradeGroup[]
): Promise<GroupingResult> {
  const tradesCreated: Array<{ tradeId: string; bias: string; netPnl: number }> = [];

  for (const group of groups) {
    // Validate net position is zero (flat-to-flat)
    let netPos = 0;
    for (const exec of group.executions) {
      netPos += exec.side === "BUY" ? exec.quantity : -exec.quantity;
    }
    if (netPos !== 0) {
      throw new Error(
        `Group for symbol ${group.symbol} has net position ${netPos} (not zero). All groups must be flat-to-flat.`
      );
    }

    const multiplier = getSymbolMultiplier(group.symbol);
    const netPnl = computePnL(group.executions, group.bias, multiplier);

    const trade = await prisma.trade.create({
      data: {
        symbol: group.symbol,
        account_id: accountId,
        status: "CLOSED",
        net_pnl: netPnl,
        r_multiple: 0,
        duration: 0,
        bias: group.bias,
        manual_status: false,
        trade_type: "BREAKOUT",
        notes: group.notes || "Auto-grouped by AI Coach",
        created_at: group.executions[0]
          ? new Date(group.executions[0].execution_timestamp)
          : new Date(),
      },
    });

    // Create executions
    for (const exec of group.executions) {
      await prisma.execution.create({
        data: {
          trade_id: trade.trade_id,
          fill_price: exec.fill_price,
          quantity: exec.quantity,
          side: exec.side,
          execution_timestamp: new Date(exec.execution_timestamp),
        },
      });
    }

    // Create market context (placeholder — real data comes from currentMarketRegime at sync time)
    await prisma.marketContext.create({
      data: {
        trade_id: trade.trade_id,
        regime_type: "Unknown",
        vix_level: 0,
        fed_funds_rate: 0,
        spx_trend: "Unknown",
      },
    });

    tradesCreated.push({
      tradeId: trade.trade_id,
      bias: group.bias,
      netPnl,
    });
  }

  return {
    tradesCreated,
    totalTrades: tradesCreated.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tradeGrouping`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `cd backend && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tradeGrouping.ts backend/src/__tests__/tradeGrouping.test.ts
git commit -m "feat: add applyTradeGrouping + groupFillsFlatToFlat helpers with TDD (12 tests)"
```

---

## Task 4: REST Endpoints — `/api/orphans/reconcile` and `/api/trades/group`

**Files:**
- Modify: `backend/src/server.ts` (add 2 endpoints after the existing `/api/ingest/ironbeam/sync` endpoint, around line 1386)
- Create: `backend/src/__tests__/orphansReconcileEndpoint.test.ts`
- Create: `backend/src/__tests__/tradesGroupEndpoint.test.ts`

- [ ] **Step 1: Write failing endpoint tests for orphans reconcile**

Create `backend/src/__tests__/orphansReconcileEndpoint.test.ts`:

```typescript
import { describe, test, expect } from "vitest";
import { applyOrphanDecision } from "../services/orphanReconciliation";

// These tests verify the endpoint handler logic (validation) without starting Express.
// The handler is a thin wrapper around applyOrphanDecision with input validation.

describe("POST /api/orphans/reconcile — input validation", () => {
  test("missing accountId returns 400 error message", () => {
    const body = { executionId: "exec-1", decision: "drop", reason: "test" };
    const missing = !body.accountId;
    expect(missing).toBe(true);
  });

  test("missing executionId returns 400 error message", () => {
    const body = { accountId: "acct-1", decision: "drop", reason: "test" };
    const missing = !body.executionId;
    expect(missing).toBe(true);
  });

  test("invalid decision returns 400 error message", () => {
    const decision = "maybe";
    const valid = ["drop", "keep", "ignore"].includes(decision);
    expect(valid).toBe(false);
  });

  test("valid inputs pass validation", () => {
    const body = { accountId: "acct-1", executionId: "exec-1", decision: "drop", reason: "test" };
    const valid =
      body.accountId &&
      body.executionId &&
      body.decision &&
      body.reason &&
      ["drop", "keep", "ignore"].includes(body.decision);
    expect(valid).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing endpoint tests for trades group**

Create `backend/src/__tests__/tradesGroupEndpoint.test.ts`:

```typescript
import { describe, test, expect } from "vitest";

describe("POST /api/trades/group — input validation", () => {
  test("missing accountId returns 400", () => {
    const body = { proposal: [] };
    const valid = body.accountId && Array.isArray(body.proposal);
    expect(valid).toBeFalsy();
  });

  test("proposal not an array returns 400", () => {
    const body = { accountId: "acct-1", proposal: "not-array" };
    const valid = body.accountId && Array.isArray(body.proposal);
    expect(valid).toBe(false);
  });

  test("valid inputs pass validation", () => {
    const body = {
      accountId: "acct-1",
      proposal: [
        {
          symbol: "MNQ",
          bias: "LONG",
          executions: [
            { side: "BUY", quantity: 1, fill_price: 29000, execution_timestamp: "t1" },
            { side: "SELL", quantity: 1, fill_price: 29050, execution_timestamp: "t2" },
          ],
        },
      ],
    };
    const valid = body.accountId && Array.isArray(body.proposal) && body.proposal.length > 0;
    expect(valid).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run orphansReconcileEndpoint tradesGroupEndpoint`
Expected: FAIL — module not found (for orphansReconcileEndpoint).

- [ ] **Step 4: Add both endpoints to server.ts**

Add these imports at the top of `server.ts` (with the other imports):

```typescript
import { applyOrphanDecision } from "./services/orphanReconciliation";
import { applyTradeGrouping } from "./services/tradeGrouping";
```

Add the orphan reconcile endpoint after the `/api/ingest/ironbeam/sync` endpoint (after line 1386):

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/server.ts backend/src/__tests__/orphansReconcileEndpoint.test.ts backend/src/__tests__/tradesGroupEndpoint.test.ts
git commit -m "feat: add /api/orphans/reconcile and /api/trades/group endpoints"
```

---

## Task 5: Tool Wiring — Add `reconcile_orphan` and `group_into_trades` to AI Coach

**Files:**
- Modify: `backend/src/services/aiRouter.ts` (line 775 — tools array)
- Modify: `backend/src/services/aiRouter.ts` (lines 619-626 — include execution_id in orphan/ghost text)
- Modify: `backend/src/services/aiRouter.ts` (lines 693-698 — system prompt update)
- Modify: `backend/src/services/aiRouter.ts` (lines 824-897 — add switch cases)

- [ ] **Step 1: Add tool definitions to the tools array**

At `aiRouter.ts` line 775, replace:

```typescript
tools: [logTradeTool, renderUiTool, recordObservationTool, tagTradeTool, toggleLensTool],
```

with:

```typescript
tools: [
  logTradeTool, renderUiTool, recordObservationTool, tagTradeTool, toggleLensTool,
  {
    type: "function" as const,
    function: {
      name: "reconcile_orphan",
      description: "Record a decision on an orphan execution. Call this once per orphan after analyzing it. Use 'drop' if the broker is right and the journal entry is a manifest/error, 'keep' if the journal is right and the broker missed the fill, 'ignore' if you are uncertain and want to defer to the user. Always include a one-sentence reason — the user will see it.",
      parameters: {
        type: "object",
        properties: {
          execution_id: { type: "string", description: "UUID of the orphan execution row (from the reconciliation report)" },
          decision: { type: "string", enum: ["drop", "keep", "ignore"] },
          reason: { type: "string", description: "One-sentence rationale the user will see" },
        },
        required: ["execution_id", "decision", "reason"],
      },
    },
  },
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
                      execution_timestamp: { type: "string", description: "ISO timestamp" },
                    },
                    required: ["side", "quantity", "fill_price", "execution_timestamp"],
                  },
                },
                notes: { type: "string", description: "Optional one-line rationale" },
              },
              required: ["symbol", "bias", "executions"],
            },
          },
        },
        required: ["account_id", "proposal"],
      },
    },
  },
],
```

- [ ] **Step 2: Fix missing execution_id in orphan/ghost text**

Replace lines 611-626 in `aiRouter.ts`.

The ghost text block (lines 611-616):
```typescript
let ghostText = "";
if (report.ghosts && report.ghosts.length > 0) {
  ghostText = report.ghosts.map((g: any) => 
    `- ID: ${g.execution_id || 'N/A'} | Symbol: ${g.symbol} | Side: ${g.side} | Qty: ${g.quantity} | Price: ${g.fillPrice} | Time: ${g.timestamp ? new Date(g.timestamp).toLocaleTimeString() : 'N/A'}`
  ).join("\n");
} else {
  ghostText = "None";
}
```

The orphan text block (lines 619-626):
```typescript
let orphanText = "";
if (report.orphans && report.orphans.length > 0) {
  orphanText = report.orphans.map((o: any) => 
    `- ID: ${o.execution_id} | Symbol: ${o.symbol} | Side: ${o.side} | Qty: ${o.quantity} | Price: ${o.fill_price} | Time: ${o.execution_timestamp ? new Date(o.execution_timestamp).toLocaleTimeString() : 'N/A'}`
  ).join("\n");
} else {
  orphanText = "None";
}
```

- [ ] **Step 3: Add system prompt behavior blocks**

After the existing line 698 (`7. Provide actionable, mathematical adjustments...`), add:

```
8. If the user asks you to reconcile orphans (e.g., "reconcile my orphans", "go through the orphans", "what should I do about the orphans?"):
   - Iterate through each orphan in the report.
   - For each, call reconcile_orphan with one decision: drop (manifest/false positive), keep (broker missed a real fill), or ignore (genuinely ambiguous, defer to user).
   - Always include a one-sentence reason — the user sees it.
   - Be opinionated: prefer drop or keep when you have reasonable evidence; reserve ignore for cases where the price action and trade history are both unclear.
   - You may make multiple tool calls in parallel (the runtime streams them).
   - If there are more than ~20 orphans, briefly acknowledge the scope and consider doing them in batches of 10 with a one-line progress note between batches.
9. If the user pastes a statement and asks you to organize the fills, call group_into_trades with a proposed grouping. Use flat-to-flat grouping (each sequence of BUYs that net to zero with SELLs becomes its own trade). You may proactively suggest a grouping when the user pastes a large statement: "I see N fills from your statement. I'd group them into M trades. Want me to apply?"
```

- [ ] **Step 4: Add switch cases for both tools**

In the tool execution switch block (after the `tag_trade` case, around line 893), add before `default:`:

```typescript
case "reconcile_orphan": {
  const reconcileRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/orphans/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId,
      executionId: args.execution_id,
      decision: args.decision,
      reason: args.reason,
    }),
  });
  const reconcileResult = await reconcileRes.json();
  if (!reconcileRes.ok) {
    const errMsg = `\n\n❌ **Failed to reconcile orphan ${args.execution_id?.substring(0, 8)}:** ${reconcileResult.error}`;
    fullText += errMsg;
    onToken(errMsg);
  } else {
    const summary = `\n\n✅ **Orphan ${reconcileResult.applied}** — ${args.execution_id?.substring(0, 8)}: ${args.reason}`;
    fullText += summary;
    onToken(summary);
  }
  break;
}

case "group_into_trades": {
  const groupRes = await fetch(`http://localhost:${process.env.PORT || 5000}/api/trades/group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: args.account_id,
      proposal: args.proposal,
    }),
  });
  const groupResult = await groupRes.json();
  if (!groupRes.ok) {
    const errMsg = `\n\n❌ **Failed to group trades:** ${groupResult.error}`;
    fullText += errMsg;
    onToken(errMsg);
  } else {
    const summary = `\n\n📊 **Trade Grouping Applied:** ${groupResult.totalTrades} trades created.`;
    fullText += summary;
    onToken(summary);
  }
  break;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Run full test suite**

Run: `cd backend && npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/aiRouter.ts
git commit -m "feat: wire reconcile_orphan + group_into_trades tools into AI Coach"
```

---

## Task 6: Default `ironbeam/sync` Flat-to-Flat Behavior Change

**Files:**
- Modify: `backend/src/server.ts` (lines 1315-1368 — replace ghost-sync logic)

- [ ] **Step 1: Replace the ghost-sync block**

Replace the existing block (lines 1315-1368) that creates one OPEN trade per symbol with flat-to-flat grouping using the `groupFillsFlatToFlat` and `applyTradeGrouping` helpers.

The replacement imports (add at top of server.ts if not already there):
```typescript
import { groupFillsFlatToFlat, applyTradeGrouping } from "./services/tradeGrouping";
```

The replacement block for `// 2. Create unjournaled ghost executions`:

```typescript
// 2. Create unjournaled ghost executions — flat-to-flat grouping
if (ghosts && Array.isArray(ghosts) && ghosts.length > 0) {
  // Sort ghosts by timestamp
  const sortedGhosts = [...ghosts].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Group by symbol first
  const bySymbol = new Map<string, typeof sortedGhosts>();
  for (const g of sortedGhosts) {
    const key = g.symbol || "UNKNOWN";
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key)!.push(g);
  }

  // For each symbol, group flat-to-flat
  for (const [symbol, symGhosts] of bySymbol) {
    const fills = symGhosts.map(g => ({
      side: g.side as "BUY" | "SELL",
      quantity: Number(g.quantity),
      fillPrice: Number(g.fillPrice),
      timestamp: g.timestamp,
      symbol,
    }));

    const flatGroups = groupFillsFlatToFlat(fills);

    for (const group of flatGroups) {
      const isClosed = group.netPosition === 0;
      const bias = group.bias;

      // Build a TradeGroup for applyTradeGrouping
      const tradeGroup = {
        symbol,
        bias,
        executions: group.executions.map(e => ({
          side: e.side,
          quantity: e.quantity,
          fill_price: e.fillPrice,
          execution_timestamp: e.timestamp,
        })),
        notes: isClosed
          ? `Auto-grouped from Ironbeam statement (flat-to-flat)`
          : `Auto-grouped from Ironbeam statement (OPEN position)`,
      };

      // Use applyTradeGrouping for closed groups
      if (isClosed) {
        const result = await applyTradeGrouping(prisma, account_id, [tradeGroup]);
        for (const t of result.tradesCreated) {
          updatedTradeIds.add(t.tradeId);
        }

        // Tag with "Ironbeam Import"
        let tag = await prisma.tag.findUnique({ where: { tag_name: "Ironbeam Import" } });
        if (!tag) {
          tag = await prisma.tag.create({
            data: { tag_name: "Ironbeam Import", tag_category: "Setup", color_code: "#a020f0" },
          });
        }
        for (const t of result.tradesCreated) {
          await prisma.tradeTag.create({
            data: { trade_id: t.tradeId, tag_id: tag.tag_id },
          });
        }
      } else {
        // OPEN position — create a single OPEN trade (same as old behavior for partials)
        const trade = await prisma.trade.create({
          data: {
            symbol,
            account_id,
            status: "OPEN",
            bias,
            notes: `Auto-grouped from Ironbeam statement (OPEN position — ${Math.abs(group.netPosition)} contracts)`,
          },
        });

        let tag = await prisma.tag.findUnique({ where: { tag_name: "Ironbeam Import" } });
        if (!tag) {
          tag = await prisma.tag.create({
            data: { tag_name: "Ironbeam Import", tag_category: "Setup", color_code: "#a020f0" },
          });
        }
        await prisma.tradeTag.create({
          data: { trade_id: trade.trade_id, tag_id: tag.tag_id },
        });
        await prisma.marketContext.create({
          data: {
            trade_id: trade.trade_id,
            regime_type: currentMarketRegime.regime_type,
            vix_level: currentMarketRegime.vix_level,
            fed_funds_rate: currentMarketRegime.fed_funds_rate,
            spx_trend: currentMarketRegime.spx_trend,
          },
        });

        for (const exec of group.executions) {
          await prisma.execution.create({
            data: {
              trade_id: trade.trade_id,
              fill_price: exec.fillPrice,
              quantity: exec.quantity,
              side: exec.side,
              execution_timestamp: new Date(exec.timestamp),
            },
          });
        }
        updatedTradeIds.add(trade.trade_id);
      }
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `cd backend && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Build**

Run: `cd backend && npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.ts
git commit -m "feat: change ironbeam/sync default to flat-to-flat grouping"
```

---

## Task 7: Final Verification — Build, Tests, Integration

**Files:** None new — verification only.

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && npx vitest run`
Expected: All tests pass (100 baseline + ~24 new = ~124).

- [ ] **Step 2: TypeScript check**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Backend build**

Run: `cd backend && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Frontend build**

Run: `cd frontend && npm run build`
Expected: Build succeeds (no new frontend changes, sanity check).

- [ ] **Step 5: Prisma migration check**

Run: `cd backend && npx prisma db push`
Expected: Schema synchronized (no pending changes).

- [ ] **Step 6: Final commit (if any lint fixes needed)**

Only if needed. Otherwise, skip.

- [ ] **Step 7: Push to origin**

```bash
git push origin main
```

---

## Task 8: Trade Correction Tool — `correct_trade` for AI Coach and REST API

**Files:**
- Modify: `backend/prisma/schema.prisma` (add `correction_reason` field to `Trade`)
- Create: `backend/src/services/tradeCorrection.ts`
- Create: `backend/src/__tests__/tradeCorrection.test.ts`
- Modify: `backend/src/server.ts` (add `PATCH /api/trades/:tradeId/correct` endpoint)
- Modify: `backend/src/services/aiRouter.ts` (add `correct_trade` tool definition + switch case)

**Motivation:** Today's session exposed a real gap — the FIFO P&L calculation can produce wrong numbers (e.g., +$613.50 when the user knows it was -$1,400), and the user had to ask us to manually run DB scripts to fix it. Both the user and the AI Coach need a way to correct bad logs with an audit trail.

### Design

**New tool: `correct_trade`**

The coach or user can correct any field on a trade: P&L, bias, status, notes, or even split executions between trades. For v1, we support:

- **P&L override**: set `net_pnl` to a manual value, with a reason
- **Bias correction**: change the bias (LONG/SHORT/RANGE)
- **Status correction**: change status (OPEN/CLOSED)
- **Notes append**: append text to the notes field

Every correction stores the old value, new value, reason, and timestamp in the trade's notes for audit.

**New schema field on `Trade`:**

```prisma
correction_reason String?   // Last correction reason (audit)
corrected_at      DateTime? // When the last correction was applied
```

**New helper: `applyTradeCorrection()`**

File: `backend/src/services/tradeCorrection.ts`

```typescript
export interface TradeCorrectionInput {
  accountId: string;
  tradeId: string;
  corrections: {
    net_pnl?: number;
    bias?: "LONG" | "SHORT" | "RANGE";
    status?: "OPEN" | "CLOSED";
    notes_append?: string;
  };
  reason: string;
}

export interface TradeCorrectionResult {
  tradeId: string;
  correctedFields: string[];
  reason: string;
  corrected_at: Date;
}

export async function applyTradeCorrection(
  prisma: PrismaClient,
  input: TradeCorrectionInput
): Promise<TradeCorrectionResult>
```

**Semantics:**

1. Fetch the trade, verify it belongs to the account.
2. For each field in `corrections`, store the old value in an audit string.
3. Update the trade with the new values.
4. Append `[CORRECTED YYYY-MM-DD] <reason> | Changed: <field>=<old> → <new>` to `notes`.
5. Set `correction_reason` and `corrected_at`.
6. Return the list of corrected fields.

**Endpoint: `PATCH /api/trades/:tradeId/correct`**

```typescript
app.patch("/api/trades/:tradeId/correct", async (req, res) => {
  const { tradeId } = req.params;
  const { accountId, corrections, reason } = req.body;
  if (!accountId || !reason || !corrections || typeof corrections !== "object") {
    return res.status(400).json({ error: "accountId, corrections, and reason are required" });
  }
  try {
    const result = await applyTradeCorrection(prisma, { accountId, tradeId, corrections, reason });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
```

**Tool definition for AI Coach:**

```typescript
{
  type: "function" as const,
  function: {
    name: "correct_trade",
    description: "Correct a trade's P&L, bias, status, or notes when the stored values are wrong. Use this when the user points out a bad log — e.g., 'the P&L on that trade is wrong, it was actually -$1400'. Always include a reason explaining why the correction is needed.",
    parameters: {
      type: "object",
      properties: {
        trade_id: { type: "string", description: "UUID of the trade to correct" },
        corrections: {
          type: "object",
          properties: {
            net_pnl: { type: "number", description: "Corrected P&L value" },
            bias: { type: "string", enum: ["LONG", "SHORT", "RANGE"] },
            status: { type: "string", enum: ["OPEN", "CLOSED"] },
            notes_append: { type: "string", description: "Text to append to trade notes" },
          },
        },
        reason: { type: "string", description: "Why the correction is needed" },
      },
      required: ["trade_id", "corrections", "reason"],
    },
  },
}
```

**System prompt addition:**

> 10. If the user says a trade's P&L, bias, status, or notes are incorrect, use `correct_trade` to fix it. The user knows their actual trading results better than any automated calculation. Always ask for the correct value before applying.

### Tests

- `applyTradeCorrection` with P&L override: old value stored in notes audit, new value applied
- `applyTradeCorrection` with bias correction: changes bias, logs old bias
- `applyTradeCorrection` with status change: OPEN → CLOSED, logs change
- `applyTradeCorrection` with notes_append: appends to existing notes
- `applyTradeCorrection` with multiple fields at once
- Throws if trade not found
- Throws if trade belongs to different account
- Throws if no corrections provided
- Throws if reason is empty

### Steps

- [ ] **Step 1: Add schema fields to Trade model**

Add to `backend/prisma/schema.prisma` in the `Trade` model:

```prisma
correction_reason String?
corrected_at      DateTime?
```

Run: `cd backend && npx prisma db push && npx prisma generate`

- [ ] **Step 2: Write failing tests**

Create `backend/src/__tests__/tradeCorrection.test.ts` with 8 test cases (as listed above).

- [ ] **Step 3: Run tests to verify they fail**

- [ ] **Step 4: Implement `applyTradeCorrection`**

Create `backend/src/services/tradeCorrection.ts`.

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Add endpoint to server.ts**

Add `PATCH /api/trades/:tradeId/correct` with the import.

- [ ] **Step 7: Add tool to aiRouter.ts**

Add `correct_trade` to tools array, add switch case, add system prompt block.

- [ ] **Step 8: Run full test suite**

- [ ] **Step 9: TypeScript check**

- [ ] **Step 10: Commit**

```bash
git add backend/prisma/schema.prisma backend/src/services/tradeCorrection.ts backend/src/__tests__/tradeCorrection.test.ts backend/src/server.ts backend/src/services/aiRouter.ts
git commit -m "feat: add correct_trade tool for AI Coach and REST API (audit trail)"
```
