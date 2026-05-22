import { PrismaClient } from "@prisma/client";
import { getSymbolMultiplier } from "./utils/multipliers";

const prisma = new PrismaClient();

async function fixTrades() {
  console.log("Starting DB trade reconciliation & correction...");

  // 1. Repair the corrupted MNQ trade exit execution price
  const badTradeId = "b2b6903f-bb78-4930-8bd2-2286440ca49f";
  
  // Find the bad execution (BUY execution with price 299600)
  const badExecution = await prisma.execution.findFirst({
    where: {
      trade_id: badTradeId,
      side: "BUY",
      fill_price: 299600,
    },
  });

  if (badExecution) {
    console.log(`Found corrupted execution ID: ${badExecution.execution_id} with price ${badExecution.fill_price}. Correcting to 29608...`);
    await prisma.execution.update({
      where: { execution_id: badExecution.execution_id },
      data: { fill_price: 29608 },
    });
    console.log("Successfully corrected corrupted execution price.");
  } else {
    console.log("Corrupted MNQ exit execution not found or already corrected.");
  }

  // 2. Re-calculate metrics/net_pnl for all trades in the database to apply point multipliers
  const trades = await prisma.trade.findMany({
    include: { executions: true },
  });

  console.log(`Recalculating P&L multipliers for all ${trades.length} trades...`);

  for (const trade of trades) {
    if (trade.executions.length === 0) continue;

    const executions = trade.executions.sort(
      (a, b) => a.execution_timestamp.getTime() - b.execution_timestamp.getTime()
    );

    const direction = executions[0].side; // "BUY" or "SELL"
    let totalEntryQty = 0;
    let totalEntryVal = 0;
    let totalExitQty = 0;
    let totalExitVal = 0;

    executions.forEach((e) => {
      const qty = Number(e.quantity);
      const price = Number(e.fill_price);

      if (e.side === direction) {
        totalEntryQty += qty;
        totalEntryVal += qty * price;
      } else {
        totalExitQty += qty;
        totalExitVal += qty * price;
      }
    });

    const avgEntryPrice = totalEntryQty > 0 ? totalEntryVal / totalEntryQty : 0;
    const avgExitPrice = totalExitQty > 0 ? totalExitVal / totalExitQty : 0;

    let netPnl = 0;
    if (totalExitQty > 0) {
      const multiplier = getSymbolMultiplier(trade.symbol);
      if (direction === "BUY") {
        netPnl = (avgExitPrice - avgEntryPrice) * totalExitQty * multiplier;
      } else {
        netPnl = (avgEntryPrice - avgExitPrice) * totalExitQty * multiplier;
      }
    }

    const status = totalExitQty >= totalEntryQty ? "CLOSED" : "OPEN";
    const initialRisk = 100; // default default
    const rMultiple = netPnl / initialRisk;

    await prisma.trade.update({
      where: { trade_id: trade.trade_id },
      data: {
        net_pnl: netPnl,
        status,
        r_multiple: rMultiple,
      },
    });
    console.log(`Trade ${trade.symbol} (${trade.trade_id.slice(0, 8)}): New Net P&L = $${netPnl.toFixed(2)}`);
  }

  console.log("Database repair and recalculation complete!");
}

fixTrades()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
