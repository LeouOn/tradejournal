"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function printTrades() {
    console.log("Fetching trades and executions from DB...");
    const trades = await prisma.trade.findMany({
        include: {
            executions: true,
            trade_tags: { include: { tag: true } },
        }
    });
    console.log(`Found ${trades.length} trades.`);
    for (const t of trades) {
        console.log(`\n=========================================`);
        console.log(`Trade ID: ${t.trade_id}`);
        console.log(`Symbol: ${t.symbol}`);
        console.log(`Status: ${t.status}`);
        console.log(`Net P&L: ${t.net_pnl}`);
        console.log(`R-Multiple: ${t.r_multiple}`);
        console.log(`Notes: ${t.notes}`);
        console.log(`Created At: ${t.created_at}`);
        console.log(`Executions (${t.executions.length}):`);
        t.executions.forEach((e) => {
            console.log(`  - Side: ${e.side} | Qty: ${e.quantity} | Price: ${e.fill_price} | Timestamp: ${e.execution_timestamp}`);
        });
    }
}
printTrades().catch(console.error).finally(() => prisma.$disconnect());
