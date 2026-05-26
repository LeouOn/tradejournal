"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const multipliers_1 = require("../utils/multipliers");
const prisma = new client_1.PrismaClient();
async function updateTradeCalculations(tradeId, initialRisk = 100) {
    const trade = await prisma.trade.findUnique({
        where: { trade_id: tradeId },
        include: { executions: true },
    });
    if (!trade)
        return;
    if (trade.executions.length === 0) {
        await prisma.trade.update({
            where: { trade_id: tradeId },
            data: {
                net_pnl: 0.0,
                status: "CLOSED",
                r_multiple: 0.0,
                duration: 0,
            },
        });
        return;
    }
    const executions = trade.executions.sort((a, b) => a.execution_timestamp.getTime() - b.execution_timestamp.getTime());
    const direction = executions[0].side;
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
        }
        else {
            totalExitQty += qty;
            totalExitVal += qty * price;
        }
    });
    const avgEntryPrice = totalEntryQty > 0 ? totalEntryVal / totalEntryQty : 0;
    const avgExitPrice = totalExitQty > 0 ? totalExitVal / totalExitQty : 0;
    let netPnl = 0;
    if (totalExitQty > 0) {
        const multiplier = (0, multipliers_1.getSymbolMultiplier)(trade.symbol);
        if (direction === "BUY") {
            netPnl = (avgExitPrice - avgEntryPrice) * totalExitQty * multiplier;
        }
        else {
            netPnl = (avgEntryPrice - avgExitPrice) * totalExitQty * multiplier;
        }
    }
    // Auto-close if exited quantity matches/exceeds entered quantity
    let status = trade.status;
    if (totalExitQty >= totalEntryQty) {
        status = "CLOSED";
    }
    else {
        if (!trade.manual_status) {
            status = "OPEN";
        }
    }
    const rMultiple = initialRisk > 0 ? netPnl / initialRisk : 0;
    let duration = 0;
    if (executions.length > 1) {
        duration = Math.round((executions[executions.length - 1].execution_timestamp.getTime() -
            executions[0].execution_timestamp.getTime()) /
            1000);
    }
    await prisma.trade.update({
        where: { trade_id: tradeId },
        data: {
            net_pnl: netPnl,
            status,
            r_multiple: rMultiple,
            duration,
        },
    });
}
describe("Integration Tests - Trading Journal Schema & Logic", () => {
    let accountId;
    beforeAll(async () => {
        // Set up a mock account
        let user = await prisma.user.findFirst();
        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: "integration-test@journal.com",
                    password_hash: "pass",
                    subscription_tier: "ELITE",
                },
            });
        }
        const account = await prisma.account.create({
            data: {
                account_name: "Test Integration Account",
                broker_name: "Test Broker",
                initial_balance: 50000,
                user_id: user.user_id,
            },
        });
        accountId = account.account_id;
    });
    afterAll(async () => {
        // Cleanup test account and related trades
        if (accountId) {
            await prisma.account.delete({
                where: { account_id: accountId },
            });
        }
        await prisma.$disconnect();
    });
    test("Should successfully create a trade with bias, bias_reversal, and trade_type", async () => {
        const trade = await prisma.trade.create({
            data: {
                symbol: "MNQ",
                status: "CLOSED",
                bias: "LONG",
                bias_reversal: true,
                trade_type: "BREAKOUT",
                account_id: accountId,
            },
        });
        expect(trade.symbol).toBe("MNQ");
        expect(trade.bias).toBe("LONG");
        expect(trade.bias_reversal).toBe(true);
        expect(trade.trade_type).toBe("BREAKOUT");
        // Clean up
        await prisma.trade.delete({ where: { trade_id: trade.trade_id } });
    });
    test("Should execute the calculations correctly and apply multipliers", async () => {
        const trade = await prisma.trade.create({
            data: {
                symbol: "MNQ",
                status: "OPEN",
                bias: "LONG",
                bias_reversal: false,
                trade_type: "BREAKOUT",
                account_id: accountId,
            },
        });
        // Add entry: Buy 2 MNQ at 18000
        const entry = await prisma.execution.create({
            data: {
                trade_id: trade.trade_id,
                side: "BUY",
                quantity: 2,
                fill_price: 18000,
                execution_timestamp: new Date("2026-05-22T10:00:00Z"),
            },
        });
        await updateTradeCalculations(trade.trade_id);
        let updated = await prisma.trade.findUnique({
            where: { trade_id: trade.trade_id },
        });
        expect(updated?.net_pnl.toNumber()).toBe(0); // No exit execution yet
        expect(updated?.status).toBe("OPEN");
        // Add partial exit: Sell 1 MNQ at 18100 (100 points move)
        // MNQ point multiplier = $2. 100 points * 1 contract * $2 = $200 P&L
        const exit1 = await prisma.execution.create({
            data: {
                trade_id: trade.trade_id,
                side: "SELL",
                quantity: 1,
                fill_price: 18100,
                execution_timestamp: new Date("2026-05-22T10:10:00Z"),
            },
        });
        await updateTradeCalculations(trade.trade_id);
        updated = await prisma.trade.findUnique({
            where: { trade_id: trade.trade_id },
        });
        expect(updated?.net_pnl.toNumber()).toBe(200);
        expect(updated?.status).toBe("OPEN"); // 1 contract remains open
        // Add final exit: Sell 1 MNQ at 18200
        // Total Exit Price: (18100*1 + 18200*1)/2 = 18150.
        // P&L = (18150 - 18000) * 2 contracts * $2 multiplier = 150 * 2 * 2 = $600
        const exit2 = await prisma.execution.create({
            data: {
                trade_id: trade.trade_id,
                side: "SELL",
                quantity: 1,
                fill_price: 18200,
                execution_timestamp: new Date("2026-05-22T10:20:00Z"),
            },
        });
        await updateTradeCalculations(trade.trade_id);
        updated = await prisma.trade.findUnique({
            where: { trade_id: trade.trade_id },
        });
        expect(updated?.net_pnl.toNumber()).toBe(600);
        expect(updated?.status).toBe("CLOSED"); // Position exhausted, should auto-close
        // Test Deleting executions: Delete one exit execution. P&L should adjust.
        await prisma.execution.delete({
            where: { execution_id: exit2.execution_id },
        });
        await updateTradeCalculations(trade.trade_id);
        updated = await prisma.trade.findUnique({
            where: { trade_id: trade.trade_id },
        });
        expect(updated?.net_pnl.toNumber()).toBe(200);
        expect(updated?.status).toBe("OPEN"); // Back to open since only 1 contract exited
        // Test Zero-Execution Reset: Delete all remaining executions.
        await prisma.execution.deleteMany({
            where: { trade_id: trade.trade_id },
        });
        await updateTradeCalculations(trade.trade_id);
        updated = await prisma.trade.findUnique({
            where: { trade_id: trade.trade_id },
        });
        expect(updated?.net_pnl.toNumber()).toBe(0);
        expect(updated?.status).toBe("CLOSED"); // Resets to closed and 0 metrics
        await prisma.trade.delete({ where: { trade_id: trade.trade_id } });
    });
    test("Export/Import loop serialization", async () => {
        // Create trade to export
        const originalTrade = await prisma.trade.create({
            data: {
                symbol: "ES",
                status: "CLOSED",
                bias: "SHORT",
                bias_reversal: false,
                trade_type: "RANGE",
                account_id: accountId,
            },
        });
        await prisma.execution.create({
            data: {
                trade_id: originalTrade.trade_id,
                side: "SELL",
                quantity: 1,
                fill_price: 5000,
                execution_timestamp: new Date(),
            },
        });
        await prisma.execution.create({
            data: {
                trade_id: originalTrade.trade_id,
                side: "BUY",
                quantity: 1,
                fill_price: 4980,
                execution_timestamp: new Date(),
            },
        });
        await updateTradeCalculations(originalTrade.trade_id);
        const tradeWithRelations = await prisma.trade.findUnique({
            where: { trade_id: originalTrade.trade_id },
            include: { executions: true, trade_tags: true },
        });
        expect(tradeWithRelations).toBeDefined();
        // Serialize
        const serialized = JSON.stringify(tradeWithRelations);
        const deserialized = JSON.parse(serialized);
        expect(deserialized.bias).toBe("SHORT");
        expect(deserialized.bias_reversal).toBe(false);
        expect(deserialized.trade_type).toBe("RANGE");
        expect(deserialized.executions.length).toBe(2);
        // Clean up
        await prisma.trade.delete({ where: { trade_id: originalTrade.trade_id } });
    });
    test("DailyChart model CRUD operations", async () => {
        const chart = await prisma.dailyChart.create({
            data: {
                date_str: "2026-05-26",
                image_path: "/uploads/test_chart.png",
                account_id: accountId,
            },
        });
        expect(chart.chart_id).toBeDefined();
        expect(chart.date_str).toBe("2026-05-26");
        expect(chart.image_path).toBe("/uploads/test_chart.png");
        const fetchedCharts = await prisma.dailyChart.findMany({
            where: { account_id: accountId, date_str: "2026-05-26" },
        });
        expect(fetchedCharts.length).toBe(1);
        expect(fetchedCharts[0].chart_id).toBe(chart.chart_id);
        await prisma.dailyChart.delete({
            where: { chart_id: chart.chart_id },
        });
        const deletedCharts = await prisma.dailyChart.findMany({
            where: { chart_id: chart.chart_id },
        });
        expect(deletedCharts.length).toBe(0);
    });
});
