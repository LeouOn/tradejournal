import { Execution } from "@prisma/client";
import { getSymbolMultiplier } from "./multipliers";

export interface VirtualTrade {
  trade_id: string; // Synthetic ID
  symbol: string;
  status: string;
  net_pnl: number;
  duration: number; // in seconds
  created_at: Date;
  account_id: string;
  executions: Execution[];
  trade_tags: any[];
  market_context: any[];
  manual_status: boolean;
  notes: string | null;
  bias: string;
  bias_reversal: boolean;
  trade_type: string;
  stop_loss: number | null;
  rules_followed: boolean;
  r_multiple: number;
}

export interface LIFOOptions {
  /** Returns the futures symbol for a given trade_id. Defaults to "MNQ". */
  symbolLookup?: (tradeId: string) => string;
}

/**
 * Projects raw Executions into Virtual Trades using LIFO (Last-In-First-Out) matching.
 *
 * Algorithm:
 * 1. Sort executions by timestamp ascending.
 * 2. Maintain two stacks: openBuys and openSells.
 * 3. For each incoming execution, match against the top of the opposite stack (LIFO).
 *    - Partial fills split the stack entry and push the remainder back.
 * 4. Unmatched executions become OPEN trades.
 *
 * Symbol & multiplier:
 * - The multiplier is resolved via `getSymbolMultiplier(symbol)` from `./multipliers`.
 * - By default, the symbol is "MNQ" for backward compatibility.
 *   Pass `symbolLookup` in options to resolve per-trade symbols dynamically.
 */
export function applyLIFOMatching(
  executions: Execution[],
  accountId: string,
  options?: LIFOOptions,
): VirtualTrade[] {
  const resolveSymbol = options?.symbolLookup ?? (() => "MNQ");

  const sortedExecs = [...executions].sort(
    (a, b) => a.execution_timestamp.getTime() - b.execution_timestamp.getTime(),
  );

  let openBuys: Execution[] = [];
  let openSells: Execution[] = [];
  const virtualTrades: VirtualTrade[] = [];

  let tradeCounter = 0;

  for (const exec of sortedExecs) {
    let remainingQty = Number(exec.quantity);

    if (exec.side === "BUY") {
      while (remainingQty > 0 && openSells.length > 0) {
        const topSell = openSells.pop()!;
        const sellQty = Number(topSell.quantity);
        const matchQty = Math.min(remainingQty, sellQty);

        const symbol = resolveSymbol(topSell.trade_id);
        const multiplier = getSymbolMultiplier(symbol);
        const pnl =
          (Number(topSell.fill_price) - Number(exec.fill_price)) *
          matchQty *
          multiplier;

        tradeCounter++;
        virtualTrades.push({
          trade_id: `LIFO-VIRTUAL-${tradeCounter}`,
          symbol,
          status: "CLOSED",
          net_pnl: pnl,
          duration:
            Math.abs(
              exec.execution_timestamp.getTime() -
                topSell.execution_timestamp.getTime(),
            ) / 1000,
          created_at: topSell.execution_timestamp,
          account_id: accountId,
          executions: [
            { ...topSell, quantity: matchQty as any },
            { ...exec, quantity: matchQty as any },
          ],
          trade_tags: [],
          market_context: [],
          manual_status: false,
          notes: null,
          bias: "SHORT",
          bias_reversal: false,
          trade_type: "SCALP",
          stop_loss: null,
          rules_followed: true,
          r_multiple: 0,
        });

        remainingQty -= matchQty;
        if (sellQty > matchQty) {
          openSells.push({
            ...topSell,
            quantity: (sellQty - matchQty) as any,
          });
        }
      }
      if (remainingQty > 0) {
        openBuys.push({ ...exec, quantity: remainingQty as any });
      }
    } else {
      // SELL
      while (remainingQty > 0 && openBuys.length > 0) {
        const topBuy = openBuys.pop()!;
        const buyQty = Number(topBuy.quantity);
        const matchQty = Math.min(remainingQty, buyQty);

        const symbol = resolveSymbol(topBuy.trade_id);
        const multiplier = getSymbolMultiplier(symbol);
        const pnl =
          (Number(exec.fill_price) - Number(topBuy.fill_price)) *
          matchQty *
          multiplier;

        tradeCounter++;
        virtualTrades.push({
          trade_id: `LIFO-VIRTUAL-${tradeCounter}`,
          symbol,
          status: "CLOSED",
          net_pnl: pnl,
          duration:
            Math.abs(
              exec.execution_timestamp.getTime() -
                topBuy.execution_timestamp.getTime(),
            ) / 1000,
          created_at: topBuy.execution_timestamp,
          account_id: accountId,
          executions: [
            { ...topBuy, quantity: matchQty as any },
            { ...exec, quantity: matchQty as any },
          ],
          trade_tags: [],
          market_context: [],
          manual_status: false,
          notes: null,
          bias: "LONG",
          bias_reversal: false,
          trade_type: "SCALP",
          stop_loss: null,
          rules_followed: true,
          r_multiple: 0,
        });

        remainingQty -= matchQty;
        if (buyQty > matchQty) {
          openBuys.push({
            ...topBuy,
            quantity: (buyQty - matchQty) as any,
          });
        }
      }
      if (remainingQty > 0) {
        openSells.push({ ...exec, quantity: remainingQty as any });
      }
    }
  }

  // Remaining open executions become "OPEN" trades
  for (const buy of openBuys) {
    tradeCounter++;
    const symbol = resolveSymbol(buy.trade_id);
    virtualTrades.push({
      trade_id: `LIFO-VIRTUAL-OPEN-${tradeCounter}`,
      symbol,
      status: "OPEN",
      net_pnl: 0,
      duration: 0,
      created_at: buy.execution_timestamp,
      account_id: accountId,
      executions: [buy],
      trade_tags: [],
      market_context: [],
      manual_status: false,
      notes: null,
      bias: "LONG",
      bias_reversal: false,
      trade_type: "RUNNER",
      stop_loss: null,
      rules_followed: true,
      r_multiple: 0,
    });
  }

  for (const sell of openSells) {
    tradeCounter++;
    const symbol = resolveSymbol(sell.trade_id);
    virtualTrades.push({
      trade_id: `LIFO-VIRTUAL-OPEN-${tradeCounter}`,
      symbol,
      status: "OPEN",
      net_pnl: 0,
      duration: 0,
      created_at: sell.execution_timestamp,
      account_id: accountId,
      executions: [sell],
      trade_tags: [],
      market_context: [],
      manual_status: false,
      notes: null,
      bias: "SHORT",
      bias_reversal: false,
      trade_type: "RUNNER",
      stop_loss: null,
      rules_followed: true,
      r_multiple: 0,
    });
  }

  return virtualTrades;
}
