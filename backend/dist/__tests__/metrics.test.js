"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const multipliers_1 = require("../utils/multipliers");
const metrics_1 = require("../utils/metrics");
describe("Futures Spec Utility Tests", () => {
    test("getSymbolMultiplier returns correct futures contract point values", () => {
        expect((0, multipliers_1.getSymbolMultiplier)("ES")).toBe(50);
        expect((0, multipliers_1.getSymbolMultiplier)("ESM6")).toBe(50);
        expect((0, multipliers_1.getSymbolMultiplier)("MES")).toBe(5);
        expect((0, multipliers_1.getSymbolMultiplier)("NQ")).toBe(20);
        expect((0, multipliers_1.getSymbolMultiplier)("MNQ")).toBe(2);
        expect((0, multipliers_1.getSymbolMultiplier)("MNQ2026")).toBe(2);
        expect((0, multipliers_1.getSymbolMultiplier)("RTY")).toBe(50);
        expect((0, multipliers_1.getSymbolMultiplier)("M2K")).toBe(5);
        expect((0, multipliers_1.getSymbolMultiplier)("YM")).toBe(5);
        expect((0, multipliers_1.getSymbolMultiplier)("MYM")).toBe(0.5);
        expect((0, multipliers_1.getSymbolMultiplier)("AAPL")).toBe(1); // Standard stock
    });
    test("getSymbolTickSize returns correct tick sizes", () => {
        expect((0, multipliers_1.getSymbolTickSize)("ES")).toBe(0.25);
        expect((0, multipliers_1.getSymbolTickSize)("MES")).toBe(0.25);
        expect((0, multipliers_1.getSymbolTickSize)("RTY")).toBe(0.1);
        expect((0, multipliers_1.getSymbolTickSize)("YM")).toBe(1.0);
        expect((0, multipliers_1.getSymbolTickSize)("TSLA")).toBe(0.01);
    });
    test("validatePriceProximity correctly flags price anomalies", () => {
        // 29638 vs 29608 (0.1% delta) - Sane
        expect((0, multipliers_1.validatePriceProximity)(29638, 29608).isValid).toBe(true);
        // 29638 vs 299600 (910% delta) - Anomalous
        expect((0, multipliers_1.validatePriceProximity)(29638, 299600).isValid).toBe(false);
        // 100 vs 131 (31% delta) - Anomalous (>30%)
        expect((0, multipliers_1.validatePriceProximity)(100, 131).isValid).toBe(false);
        // 100 vs 129 (29% delta) - Sane (<30%)
        expect((0, multipliers_1.validatePriceProximity)(100, 129).isValid).toBe(true);
    });
});
describe("Metrics Calculation Tests", () => {
    const initialBalance = 50000;
    test("calculateMetrics calculates win rate, profit factor, drawdown, and rule adherence", () => {
        const mockTrades = [
            {
                trade_id: "1",
                symbol: "ES",
                status: "CLOSED",
                net_pnl: 1000, // Win
                r_multiple: 2,
                duration: 3600,
                rules_followed: true,
                created_at: new Date("2026-05-22T10:00:00Z"),
            },
            {
                trade_id: "2",
                symbol: "NQ",
                status: "CLOSED",
                net_pnl: -500, // Loss (disciplined)
                r_multiple: -1,
                duration: 1800,
                rules_followed: true,
                created_at: new Date("2026-05-22T11:00:00Z"),
            },
            {
                trade_id: "3",
                symbol: "AAPL",
                status: "CLOSED",
                net_pnl: -200, // Loss (indisciplined)
                r_multiple: -0.5,
                duration: 900,
                rules_followed: false,
                created_at: new Date("2026-05-22T12:00:00Z"),
            },
            {
                trade_id: "4",
                symbol: "MES",
                status: "OPEN", // Should be ignored in metric summary
                net_pnl: 1000,
                r_multiple: 2,
                duration: 0,
                rules_followed: true,
                created_at: new Date("2026-05-22T13:00:00Z"),
            },
        ];
        const metrics = (0, metrics_1.calculateMetrics)(mockTrades, initialBalance);
        // Total closed trades = 3
        expect(metrics.totalTrades).toBe(3);
        // 1 Win, 2 Losses
        expect(metrics.winningTrades).toBe(1);
        expect(metrics.losingTrades).toBe(2);
        // Win rate = 1 / 3 = ~33.3%
        expect(metrics.winRate).toBeCloseTo(0.333, 3);
        // Gross profits = 1000, Gross losses = 500 + 200 = 700
        expect(metrics.grossProfits).toBe(1000);
        expect(metrics.grossLosses).toBe(700);
        // Profit factor = 1000 / 700 = ~1.43
        expect(metrics.profitFactor).toBeCloseTo(1.4285, 3);
        // Rule Adherence = 2 / 3 = ~66.7%
        expect(metrics.ruleAdherenceRate).toBeCloseTo(0.667, 3);
        // Cost of indiscipline = 200 (from losing indisciplined trade)
        expect(metrics.costOfIndiscipline).toBe(200);
        // Drawdown check:
        // Start: 50,000
        // Trade 1: +1000 -> 51,000 (peak = 51,000)
        // Trade 2: -500 -> 50,500 (drawdown = 500 / 51,000 = ~0.98%)
        // Trade 3: -200 -> 50,300 (drawdown = 700 / 51,000 = ~1.37%)
        // Max drawdown = ~1.37%
        expect(metrics.maxDrawdown).toBeCloseTo(1.3725, 3);
    });
});
