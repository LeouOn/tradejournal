"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateMetrics = calculateMetrics;
function calculateMetrics(trades, initialBalance) {
    const closedTrades = trades
        .filter((t) => t.status === "CLOSED")
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const totalTrades = closedTrades.length;
    if (totalTrades === 0) {
        return {
            winRate: 0,
            profitFactor: 0,
            expectancyNominal: 0,
            expectancyR: 0,
            maxDrawdown: 0,
            zellaScore: 0,
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            breakEvenTrades: 0,
            grossProfits: 0,
            grossLosses: 0,
            ruleAdherenceRate: 0,
            costOfIndiscipline: 0,
            equityCurve: [{ tradeIndex: 0, pnl: 0, balance: initialBalance, date: new Date().toLocaleDateString() }],
        };
    }
    let wins = 0;
    let losses = 0;
    let breakEven = 0;
    let grossProfits = 0;
    let grossLosses = 0;
    let rulesFollowedCount = 0;
    let costOfIndiscipline = 0;
    closedTrades.forEach((t) => {
        const pnl = Number(t.net_pnl);
        if (pnl > 0.001) {
            wins++;
            grossProfits += pnl;
        }
        else if (pnl < -0.001) {
            losses++;
            grossLosses += Math.abs(pnl);
            // Cost of indiscipline calculation
            if (!t.rules_followed) {
                costOfIndiscipline += Math.abs(pnl);
            }
        }
        else {
            breakEven++;
        }
        if (t.rules_followed) {
            rulesFollowedCount++;
        }
    });
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const profitFactor = grossLosses > 0 ? grossProfits / grossLosses : grossProfits > 0 ? 99.9 : 0;
    const ruleAdherenceRate = totalTrades > 0 ? rulesFollowedCount / totalTrades : 1.0;
    // Expectancy (Nominal) = (WinRate * AvgWin) - (LossRate * AvgLoss)
    const avgWin = wins > 0 ? grossProfits / wins : 0;
    const avgLoss = losses > 0 ? grossLosses / losses : 0;
    const lossRate = totalTrades > 0 ? losses / totalTrades : 0;
    const expectancyNominal = winRate * avgWin - lossRate * avgLoss;
    // Expectancy (R-multiple) = Average R of all trades
    const sumR = closedTrades.reduce((acc, t) => acc + Number(t.r_multiple), 0);
    const expectancyR = totalTrades > 0 ? sumR / totalTrades : 0;
    // Drawdown and Equity Curve calculation
    let currentBalance = initialBalance;
    let peakBalance = initialBalance;
    let maxDrawdownPercent = 0;
    const equityCurve = [{ tradeIndex: 0, pnl: 0, balance: initialBalance, date: "Start" }];
    closedTrades.forEach((t, index) => {
        const pnl = Number(t.net_pnl);
        currentBalance += pnl;
        if (currentBalance > peakBalance) {
            peakBalance = currentBalance;
        }
        const dd = ((peakBalance - currentBalance) / peakBalance) * 100;
        if (dd > maxDrawdownPercent) {
            maxDrawdownPercent = dd;
        }
        equityCurve.push({
            tradeIndex: index + 1,
            pnl,
            balance: currentBalance,
            date: new Date(t.created_at).toLocaleDateString(),
        });
    });
    // Gamified Zella Score calculation (0 - 100)
    // Weighted: Profit Factor (25%), Win Rate (20%), Rule Adherence (25%), Max Drawdown (15%), Recovery Factor (15%)
    // Recovery Factor = Net Profit / Max Drawdown Amount (if drawdown exists, otherwise max)
    const netProfit = currentBalance - initialBalance;
    const maxDDAmount = peakBalance - (peakBalance * (1 - maxDrawdownPercent / 100));
    const recoveryFactor = maxDDAmount > 0 ? netProfit / maxDDAmount : netProfit > 0 ? 5 : 0;
    // Win Rate Score: 40-60% strong (100 pts), scaled down below 40%
    let winRateScore = 0;
    if (winRate >= 0.5)
        winRateScore = 100;
    else if (winRate >= 0.3)
        winRateScore = ((winRate - 0.3) / 0.2) * 100;
    // Profit Factor Score: >= 1.5 (100 pts), 1.0 to 1.5 scaled, < 1.0 (0 pts)
    let pfScore = 0;
    if (profitFactor >= 1.5)
        pfScore = 100;
    else if (profitFactor >= 1.0)
        pfScore = ((profitFactor - 1.0) / 0.5) * 100;
    // Rule Adherence Score: >= 90% (100 pts), scaled down to 50%
    let ruleScore = 0;
    if (ruleAdherenceRate >= 0.9)
        ruleScore = 100;
    else if (ruleAdherenceRate >= 0.5)
        ruleScore = ((ruleAdherenceRate - 0.5) / 0.4) * 100;
    // Max Drawdown Score: <= 5% (100 pts), 5% to 15% scaled down, > 15% (0 pts)
    let ddScore = 0;
    if (maxDrawdownPercent <= 5)
        ddScore = 100;
    else if (maxDrawdownPercent <= 15)
        ddScore = ((15 - maxDrawdownPercent) / 10) * 100;
    // Recovery Factor Score: >= 3 (100 pts), scaled down to 0
    let rfScore = 0;
    if (recoveryFactor >= 3)
        rfScore = 100;
    else if (recoveryFactor > 0)
        rfScore = (recoveryFactor / 3) * 100;
    const rawZella = (winRateScore * 0.20 +
        pfScore * 0.25 +
        ruleScore * 0.25 +
        ddScore * 0.15 +
        rfScore * 0.15);
    // Buffer score when user has very few trades to avoid volatile swings
    let zellaScore = Math.max(0, Math.min(100, Math.round(rawZella)));
    if (totalTrades < 5) {
        zellaScore = Math.round(50 + (zellaScore - 50) * (totalTrades / 5));
    }
    return {
        winRate,
        profitFactor,
        expectancyNominal,
        expectancyR,
        maxDrawdown: maxDrawdownPercent,
        zellaScore,
        totalTrades,
        winningTrades: wins,
        losingTrades: losses,
        breakEvenTrades: breakEven,
        grossProfits,
        grossLosses,
        ruleAdherenceRate,
        costOfIndiscipline,
        equityCurve,
    };
}
