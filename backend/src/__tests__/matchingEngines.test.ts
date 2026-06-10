import { applyLIFOMatching, VirtualTrade } from "../utils/matchingEngines";
import { Execution } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers – build minimal Execution-like objects that satisfy the Prisma type.
// Prisma Decimal fields (fill_price, quantity) are strings in the raw object;
// we use `as unknown as Execution` to avoid constructing a full Decimal.
// ---------------------------------------------------------------------------

type ExecSeed = {
  fill_price: number;
  quantity: number;
  side: "BUY" | "SELL";
  timestamp: Date;
  trade_id: string;
};

function makeExec(seed: ExecSeed): Execution {
  return {
    execution_id: `exec-${Math.random().toString(36).slice(2, 9)}`,
    fill_price: seed.fill_price as any,       // Prisma Decimal stored as string/number
    quantity: seed.quantity as any,
    side: seed.side,
    execution_timestamp: seed.timestamp,
    trade_id: seed.trade_id,
  } as unknown as Execution;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyLIFOMatching", () => {
  const accountId = "acct-001";

  // 1. Empty input -----------------------------------------------------------
  test("returns empty array for empty input", () => {
    const result = applyLIFOMatching([], accountId);
    expect(result).toEqual([]);
  });

  // 2. LIFO order verification -----------------------------------------------
  test("SELL matches most recent BUY (LIFO order)", () => {
    // BUY 1 @ 100, then BUY 1 @ 110, then SELL 1 @ 120
    // LIFO: SELL matches the 110 BUY → pnl = (120 - 110) * 1 * multiplier
    const execs = [
      makeExec({ fill_price: 100, quantity: 1, side: "BUY", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t1" }),
      makeExec({ fill_price: 110, quantity: 1, side: "BUY", timestamp: new Date("2026-01-01T10:01:00Z"), trade_id: "t2" }),
      makeExec({ fill_price: 120, quantity: 1, side: "SELL", timestamp: new Date("2026-01-01T10:02:00Z"), trade_id: "t3" }),
    ];

    const trades = applyLIFOMatching(execs, accountId);
    // Should produce 1 closed trade + 1 open trade (the first BUY)
    expect(trades.length).toBeGreaterThanOrEqual(1);

    const closed = trades.find(t => t.status === "CLOSED");
    expect(closed).toBeDefined();

    // LIFO: matched against the 110 BUY, not the 100 BUY
    // pnl = (120 - 110) * 1 * 2 = 20  (MNQ default multiplier)
    expect(closed!.net_pnl).toBe(20);

    // One open BUY should remain
    const openTrades = trades.filter(t => t.status === "OPEN");
    expect(openTrades.length).toBe(1);
    expect(Number(openTrades[0].executions[0].fill_price)).toBe(100);
  });

  // 3. Partial fills ---------------------------------------------------------
  test("partial fill: 5-lot BUY then 2-lot SELL leaves 3 open", () => {
    const execs = [
      makeExec({ fill_price: 100, quantity: 5, side: "BUY", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t1" }),
      makeExec({ fill_price: 110, quantity: 2, side: "SELL", timestamp: new Date("2026-01-01T10:01:00Z"), trade_id: "t2" }),
    ];

    const trades = applyLIFOMatching(execs, accountId);
    const closed = trades.find(t => t.status === "CLOSED");
    const open = trades.find(t => t.status === "OPEN");

    expect(closed).toBeDefined();
    expect(open).toBeDefined();

    // Closed trade: matched qty on both sides should be 2
    expect(Number(closed!.executions[0].quantity)).toBe(2);
    expect(Number(closed!.executions[1].quantity)).toBe(2);

    // Open trade has 3 remaining
    expect(Number(open!.executions[0].quantity)).toBe(3);
  });

  // 4. Symbol multiplier -----------------------------------------------------
  test("different symbols produce different PnLs via getMultiplier", () => {
    // Default (MNQ, multiplier 2): BUY 1 @ 100, SELL 1 @ 110 → pnl = 10 * 2 = 20
    const mnqExecs = [
      makeExec({ fill_price: 100, quantity: 1, side: "BUY", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t1" }),
      makeExec({ fill_price: 110, quantity: 1, side: "SELL", timestamp: new Date("2026-01-01T10:01:00Z"), trade_id: "t2" }),
    ];

    // ES (multiplier 50) via symbolLookup override
    const esExecs = [
      makeExec({ fill_price: 100, quantity: 1, side: "BUY", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t1" }),
      makeExec({ fill_price: 110, quantity: 1, side: "SELL", timestamp: new Date("2026-01-01T10:01:00Z"), trade_id: "t2" }),
    ];

    // Default (MNQ multiplier = 2)
    const mnqResult = applyLIFOMatching(mnqExecs, accountId);
    const mnqClosed = mnqResult.find(t => t.status === "CLOSED")!;
    expect(mnqClosed).toBeDefined();
    expect(mnqClosed.net_pnl).toBe(20); // (110-100) * 1 * 2

    // ES multiplier via symbolLookup
    const esResult = applyLIFOMatching(esExecs, accountId, {
      symbolLookup: () => "ES",
    });
    const esClosed = esResult.find(t => t.status === "CLOSED")!;
    expect(esClosed).toBeDefined();
    expect(esClosed.net_pnl).toBe(500); // (110-100) * 1 * 50

    // Verify they're different
    expect(esClosed.net_pnl).not.toBe(mnqClosed.net_pnl);
  });

  // 5. Unmatched opens become OPEN trades ------------------------------------
  test("unmatched BUY 5 with no close → OPEN trade with quantity 5", () => {
    const execs = [
      makeExec({ fill_price: 100, quantity: 5, side: "BUY", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t1" }),
    ];

    const trades = applyLIFOMatching(execs, accountId);
    expect(trades.length).toBe(1);
    expect(trades[0].status).toBe("OPEN");
    expect(trades[0].bias).toBe("LONG");
    expect(Number(trades[0].executions[0].quantity)).toBe(5);
  });

  // 6. Long vs short bias ----------------------------------------------------
  test("BUY→SELL produces LONG bias, SELL→BUY produces SHORT bias", () => {
    const longExecs = [
      makeExec({ fill_price: 100, quantity: 1, side: "BUY", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t1" }),
      makeExec({ fill_price: 110, quantity: 1, side: "SELL", timestamp: new Date("2026-01-01T10:01:00Z"), trade_id: "t2" }),
    ];

    const shortExecs = [
      makeExec({ fill_price: 110, quantity: 1, side: "SELL", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t3" }),
      makeExec({ fill_price: 100, quantity: 1, side: "BUY", timestamp: new Date("2026-01-01T10:01:00Z"), trade_id: "t4" }),
    ];

    const longTrades = applyLIFOMatching(longExecs, accountId);
    const shortTrades = applyLIFOMatching(shortExecs, accountId);

    const longClosed = longTrades.find(t => t.status === "CLOSED")!;
    const shortClosed = shortTrades.find(t => t.status === "CLOSED")!;

    expect(longClosed.bias).toBe("LONG");
    expect(shortClosed.bias).toBe("SHORT");

    // Verify PnL direction
    expect(longClosed.net_pnl).toBeGreaterThan(0);  // (110-100)*1*2 = 20
    expect(shortClosed.net_pnl).toBeGreaterThan(0);  // (110-100)*1*2 = 20
  });

  // 7. Multiple trades from many executions ----------------------------------
  test("10 alternating BUY/SELL executions produce 5 closed trades", () => {
    const execs: Execution[] = [];
    for (let i = 0; i < 5; i++) {
      execs.push(
        makeExec({
          fill_price: 100 + i * 10,
          quantity: 1,
          side: "BUY",
          timestamp: new Date(`2026-01-01T10:0${i}:00Z`),
          trade_id: `t${i * 2 + 1}`,
        }),
      );
      execs.push(
        makeExec({
          fill_price: 105 + i * 10,
          quantity: 1,
          side: "SELL",
          timestamp: new Date(`2026-01-01T10:0${i}:30Z`),
          trade_id: `t${i * 2 + 2}`,
        }),
      );
    }

    const trades = applyLIFOMatching(execs, accountId);
    const closed = trades.filter(t => t.status === "CLOSED");
    const open = trades.filter(t => t.status === "OPEN");

    // Each BUY is immediately followed by a SELL with qty 1, so 5 closed, 0 open
    expect(closed.length).toBe(5);
    expect(open.length).toBe(0);

    // All should have positive PnL (sell > buy in each pair)
    for (const ct of closed) {
      expect(ct.net_pnl).toBeGreaterThan(0);
    }
  });

  // 8. Symbol on closed trades uses lookup -----------------------------------
  test("symbolLookup is used to set symbol on closed trades", () => {
    const execs = [
      makeExec({ fill_price: 100, quantity: 1, side: "BUY", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t1" }),
      makeExec({ fill_price: 110, quantity: 1, side: "SELL", timestamp: new Date("2026-01-01T10:01:00Z"), trade_id: "t2" }),
    ];

    const trades = applyLIFOMatching(execs, accountId, {
      symbolLookup: () => "ES",
    });

    const closed = trades.find(t => t.status === "CLOSED")!;
    expect(closed.symbol).toBe("ES");
  });

  // 9. Default symbol is MNQ when no lookup provided -------------------------
  test("default symbol is MNQ when no symbolLookup provided", () => {
    const execs = [
      makeExec({ fill_price: 100, quantity: 1, side: "BUY", timestamp: new Date("2026-01-01T10:00:00Z"), trade_id: "t1" }),
      makeExec({ fill_price: 110, quantity: 1, side: "SELL", timestamp: new Date("2026-01-01T10:01:00Z"), trade_id: "t2" }),
    ];

    const trades = applyLIFOMatching(execs, accountId);
    const closed = trades.find(t => t.status === "CLOSED")!;
    expect(closed.symbol).toBe("MNQ");
  });
});
