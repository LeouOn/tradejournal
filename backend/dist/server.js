"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const ws_1 = require("ws");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const aiRouter_1 = require("./services/aiRouter");
const metrics_1 = require("./utils/metrics");
const multipliers_1 = require("./utils/multipliers");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const externalApi_1 = __importStar(require("./routes/externalApi"));
const child_process_1 = require("child_process");
const node_cron_1 = __importDefault(require("node-cron"));
const openai_1 = require("openai");
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
const prisma = new client_1.PrismaClient();
const PORT = process.env.PORT || 5000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "50mb" }));
app.use(express_1.default.urlencoded({ limit: "50mb", extended: true }));
const uploadsDir = path_1.default.join(process.cwd(), "uploads");
if (!fs_1.default.existsSync(uploadsDir)) {
    fs_1.default.mkdirSync(uploadsDir);
}
app.use("/uploads", express_1.default.static(uploadsDir));
// Wire up the external API router for Marketpulse
app.use("/api/external", externalApi_1.default);
// Active WebSocket connections
const clients = new Set();
wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`WebSocket client connected. Total: ${clients.size}`);
    ws.on("close", () => {
        clients.delete(ws);
        console.log(`WebSocket client disconnected. Total: ${clients.size}`);
    });
});
// Helper: Broadcast to all connected WebSocket clients
function broadcast(data) {
    const payload = JSON.stringify(data);
    clients.forEach((client) => {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(payload);
        }
    });
}
// Current market regime state (global cache, updated by HMM script or manually)
let currentMarketRegime = {
    regime_type: "Bullish - Low Volatility",
    vix_level: 14.5,
    fed_funds_rate: 5.25,
    spx_trend: "ABOVE_200SMA",
    spx_close: 5800,
    spx_200sma: 5600,
    spx_dist_200sma: 3.57,
    atr_ratio: 0.012,
    spx_5d_return: 0.45,
    spx_20d_return: 2.1,
    spx_60d_return: 5.8,
    vix_percentile: 22,
    regime_date: new Date().toISOString().split("T")[0],
    regime_description: "Market regime classification pending. Run the ML pipeline (npm run ml:run) to populate with live data.",
    state_profiles: [],
};
(0, externalApi_1.setRegimeUpdater)((newRegime) => {
    currentMarketRegime = { ...currentMarketRegime, ...newRegime };
    broadcast({ type: "REGIME_SHIFT", regime: currentMarketRegime });
});
/**
 * ----------------------------------------------------
 * ACCOUNTS ENDPOINTS
 * ----------------------------------------------------
 */
app.get("/api/accounts", async (req, res) => {
    try {
        const accounts = await prisma.account.findMany();
        res.json(accounts);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post("/api/accounts", async (req, res) => {
    const { account_name, broker_name, initial_balance, currency, user_id } = req.body;
    try {
        // Find or create default user if not specified
        let targetUserId = user_id;
        if (!targetUserId) {
            let defaultUser = await prisma.user.findFirst();
            if (!defaultUser) {
                defaultUser = await prisma.user.create({
                    data: {
                        email: "trader@journal.com",
                        password_hash: "demo-hash",
                        subscription_tier: "ELITE",
                    },
                });
            }
            targetUserId = defaultUser.user_id;
        }
        const account = await prisma.account.create({
            data: {
                account_name,
                broker_name,
                initial_balance: Number(initial_balance),
                currency: currency || "USD",
                user_id: targetUserId,
            },
        });
        // Create default tags on first account creation if none exist
        const tagCount = await prisma.tag.count();
        if (tagCount === 0) {
            await prisma.tag.createMany({
                data: [
                    { tag_name: "VWAP Bounce", tag_category: "Setup", color_code: "#00e5ff" },
                    { tag_name: "Breakout", tag_category: "Setup", color_code: "#00e676" },
                    { tag_name: "Mean Reversion", tag_category: "Setup", color_code: "#a020f0" },
                    { tag_name: "FOMO Chasing", tag_category: "Emotion", color_code: "#ffb700" },
                    { tag_name: "Revenge Trade", tag_category: "Emotion", color_code: "#ff2d55" },
                    { tag_name: "Disciplined Stop", tag_category: "Error", color_code: "#4a7898" },
                    { tag_name: "Held Loser Too Long", tag_category: "Error", color_code: "#e2ebd5" },
                ],
            });
        }
        res.json(account);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * ----------------------------------------------------
 * TRADES & EXECUTIONS ENDPOINTS (Phase 1 core focus)
 * ----------------------------------------------------
 */
app.get("/api/trades", async (req, res) => {
    const { accountId } = req.query;
    try {
        const trades = await prisma.trade.findMany({
            where: accountId ? { account_id: String(accountId) } : undefined,
            include: {
                executions: true,
                trade_tags: { include: { tag: true } },
                market_context: true,
            },
            orderBy: { created_at: "desc" },
        });
        res.json(trades);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Helper: Recalculate average fill prices, net realized P&L, status, and duration
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
    const direction = executions[0].side; // "BUY" or "SELL" (defines Long vs Short)
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
            // Long: P&L = (Exit - Entry) * Qty * Multiplier
            netPnl = (avgExitPrice - avgEntryPrice) * totalExitQty * multiplier;
        }
        else {
            // Short: P&L = (Entry - Exit) * Qty * Multiplier
            netPnl = (avgEntryPrice - avgExitPrice) * totalExitQty * multiplier;
        }
    }
    // Auto-close if exited quantity matches/exceeds entered quantity (always forces CLOSED)
    let status = trade.status;
    if (totalExitQty >= totalEntryQty) {
        status = "CLOSED";
    }
    else {
        if (!trade.manual_status) {
            status = "OPEN";
        }
    }
    // R-Multiple
    let calculatedRisk = initialRisk;
    const stopLossVal = trade.stop_loss ? Number(trade.stop_loss) : 0;
    if (stopLossVal > 0 && totalEntryQty > 0) {
        const firstEntryPrice = executions[0].fill_price ? Number(executions[0].fill_price) : avgEntryPrice;
        const firstEntryQty = executions[0].quantity ? Number(executions[0].quantity) : totalEntryQty;
        const multiplier = (0, multipliers_1.getSymbolMultiplier)(trade.symbol);
        const riskPoints = Math.abs(firstEntryPrice - stopLossVal);
        calculatedRisk = riskPoints * firstEntryQty * multiplier;
    }
    if (calculatedRisk <= 0) {
        calculatedRisk = initialRisk || 100;
    }
    const rMultiple = calculatedRisk > 0 ? netPnl / calculatedRisk : 0;
    // Duration
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
app.post("/api/trades", async (req, res) => {
    const { symbol, account_id, initial_risk, rules_followed, notes, tags, status, manual_status, bias, bias_reversal, trade_type, created_at, stop_loss } = req.body;
    try {
        // 1. Generate text embedding for qualitative notes in background
        let embeddingStr = null;
        if (notes && notes.trim() !== "") {
            const vec = await (0, aiRouter_1.generateEmbedding)(notes);
            embeddingStr = JSON.stringify(vec);
        }
        // 2. Create trade
        const trade = await prisma.trade.create({
            data: {
                symbol,
                account_id,
                status: status || "CLOSED", // By default it should be CLOSED as requested
                manual_status: manual_status !== undefined ? manual_status : false,
                rules_followed: rules_followed !== undefined ? rules_followed : true,
                notes,
                notes_vector: embeddingStr,
                bias: bias || "RANGE",
                bias_reversal: bias_reversal !== undefined ? bias_reversal : false,
                trade_type: trade_type || "BREAKOUT",
                created_at: created_at ? new Date(created_at) : undefined,
                stop_loss: stop_loss !== undefined && stop_loss !== null ? Number(stop_loss) : null,
            },
        });
        // 3. Connect Tags
        if (tags && Array.isArray(tags)) {
            for (const tagName of tags) {
                let tag = await prisma.tag.findUnique({ where: { tag_name: tagName } });
                if (!tag) {
                    tag = await prisma.tag.create({
                        data: { tag_name: tagName, tag_category: "Setup", color_code: "#00e5ff" },
                    });
                }
                await prisma.tradeTag.create({
                    data: {
                        trade_id: trade.trade_id,
                        tag_id: tag.tag_id,
                    },
                });
            }
        }
        // 4. Bind Macro Market Context permanently
        await prisma.marketContext.create({
            data: {
                trade_id: trade.trade_id,
                regime_type: currentMarketRegime.regime_type,
                vix_level: currentMarketRegime.vix_level,
                fed_funds_rate: currentMarketRegime.fed_funds_rate,
                spx_trend: currentMarketRegime.spx_trend,
            },
        });
        res.json(trade);
        broadcast({ type: "TRADE_CREATED", trade_id: trade.trade_id });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});
// Update trade fields (e.g. status, notes, tags, rules_followed, initial risk)
app.patch("/api/trades/:tradeId", async (req, res) => {
    const { tradeId } = req.params;
    const { status, manual_status, notes, rules_followed, tags, initial_risk, bias, bias_reversal, trade_type, stop_loss } = req.body;
    try {
        const existingTrade = await prisma.trade.findUnique({
            where: { trade_id: tradeId },
        });
        if (!existingTrade) {
            return res.status(404).json({ error: "Trade not found" });
        }
        // 1. Update text embedding if notes changed
        let embeddingStr = existingTrade.notes_vector;
        if (notes !== undefined && notes !== existingTrade.notes) {
            if (notes && notes.trim() !== "") {
                const vec = await (0, aiRouter_1.generateEmbedding)(notes);
                embeddingStr = JSON.stringify(vec);
            }
            else {
                embeddingStr = null;
            }
        }
        // 2. Update tags if provided
        if (tags && Array.isArray(tags)) {
            // Clear existing tags
            await prisma.tradeTag.deleteMany({ where: { trade_id: tradeId } });
            // Create new ones
            for (const tagName of tags) {
                let tag = await prisma.tag.findUnique({ where: { tag_name: tagName } });
                if (!tag) {
                    tag = await prisma.tag.create({
                        data: { tag_name: tagName, tag_category: "Setup", color_code: "#00e5ff" },
                    });
                }
                await prisma.tradeTag.create({
                    data: {
                        trade_id: tradeId,
                        tag_id: tag.tag_id,
                    },
                });
            }
        }
        // 3. Update trade model fields
        const updatedTrade = await prisma.trade.update({
            where: { trade_id: tradeId },
            data: {
                status: status !== undefined ? status : existingTrade.status,
                manual_status: manual_status !== undefined ? manual_status : existingTrade.manual_status,
                notes: notes !== undefined ? notes : existingTrade.notes,
                notes_vector: embeddingStr,
                rules_followed: rules_followed !== undefined ? rules_followed : existingTrade.rules_followed,
                bias: bias !== undefined ? bias : existingTrade.bias,
                bias_reversal: bias_reversal !== undefined ? bias_reversal : existingTrade.bias_reversal,
                trade_type: trade_type !== undefined ? trade_type : existingTrade.trade_type,
                stop_loss: stop_loss !== undefined ? (stop_loss !== null ? Number(stop_loss) : null) : undefined,
            },
        });
        // 4. Trigger calculations update (handles P&L and metrics)
        await updateTradeCalculations(tradeId, initial_risk ? Number(initial_risk) : 100);
        // Fetch final trade structure
        const finalTrade = await prisma.trade.findUnique({
            where: { trade_id: tradeId },
            include: { executions: true, trade_tags: { include: { tag: true } }, market_context: true },
        });
        res.json(finalTrade);
        broadcast({ type: "TRADE_UPDATED", trade: finalTrade });
    }
    catch (error) {
        console.error("Error patching trade:", error);
        res.status(500).json({ error: error.message });
    }
});
// Logs an execution for a trade, automatically triggering metric updates
app.post("/api/executions", async (req, res) => {
    const { trade_id, fill_price, quantity, side, execution_timestamp, initial_risk } = req.body;
    try {
        const trade = await prisma.trade.findUnique({
            where: { trade_id },
            include: { executions: true },
        });
        if (!trade) {
            return res.status(404).json({ error: "Trade not found" });
        }
        const newPrice = Number(fill_price);
        const qty = Number(quantity);
        if (isNaN(newPrice) || newPrice <= 0) {
            return res.status(400).json({ error: "Price must be a positive number greater than zero." });
        }
        if (isNaN(qty) || qty <= 0) {
            return res.status(400).json({ error: "Quantity must be a positive number greater than zero." });
        }
        if (trade.executions.length > 0) {
            const firstPrice = Number(trade.executions[0].fill_price);
            const { isValid, percentageDelta } = (0, multipliers_1.validatePriceProximity)(firstPrice, newPrice);
            if (!isValid) {
                return res.status(400).json({
                    error: `Execution price of ${newPrice} is too far from existing trade fill price of ${firstPrice} (${(percentageDelta * 100).toFixed(1)}% delta). Possible typo detected.`
                });
            }
        }
        const execution = await prisma.execution.create({
            data: {
                trade_id,
                fill_price: newPrice,
                quantity: qty,
                side,
                execution_timestamp: execution_timestamp ? new Date(execution_timestamp) : new Date(),
            },
        });
        // Recalculate trade figures
        await updateTradeCalculations(trade_id, initial_risk ? Number(initial_risk) : 100);
        // Fetch updated trade for response and broadcast
        const updatedTrade = await prisma.trade.findUnique({
            where: { trade_id },
            include: { executions: true, trade_tags: { include: { tag: true } }, market_context: true },
        });
        res.json(execution);
        broadcast({ type: "TRADE_UPDATED", trade: updatedTrade });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.delete("/api/trades/:tradeId", async (req, res) => {
    const { tradeId } = req.params;
    try {
        await prisma.trade.delete({ where: { trade_id: tradeId } });
        res.json({ success: true });
        broadcast({ type: "TRADE_DELETED", trade_id: tradeId });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get("/api/trades/export", async (req, res) => {
    try {
        const trades = await prisma.trade.findMany({
            include: {
                executions: true,
                trade_tags: { include: { tag: true } },
                market_context: true,
            },
        });
        res.json(trades);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post("/api/trades/import", async (req, res) => {
    const { trades, accountId } = req.body;
    if (!trades || !Array.isArray(trades)) {
        return res.status(400).json({ error: "Invalid import format. Expected an array of trades." });
    }
    try {
        let targetAccountId = accountId;
        if (!targetAccountId) {
            const defaultAcc = await prisma.account.findFirst();
            if (!defaultAcc) {
                return res.status(400).json({ error: "No account found. Create an account first." });
            }
            targetAccountId = defaultAcc.account_id;
        }
        const importedTrades = [];
        for (const t of trades) {
            // Validate executions
            if (t.executions && Array.isArray(t.executions)) {
                for (const e of t.executions) {
                    if (Number(e.quantity) <= 0 || Number(e.fill_price) <= 0) {
                        return res.status(400).json({ error: "Execution quantity and price must be greater than zero." });
                    }
                }
            }
            const newTrade = await prisma.trade.create({
                data: {
                    symbol: t.symbol,
                    status: t.status || "CLOSED",
                    manual_status: t.manual_status !== undefined ? t.manual_status : false,
                    net_pnl: t.net_pnl !== undefined ? Number(t.net_pnl) : 0,
                    r_multiple: t.r_multiple !== undefined ? Number(t.r_multiple) : 0,
                    duration: t.duration !== undefined ? Number(t.duration) : 0,
                    rules_followed: t.rules_followed !== undefined ? t.rules_followed : true,
                    notes: t.notes,
                    notes_vector: t.notes_vector,
                    bias: t.bias || "RANGE",
                    bias_reversal: t.bias_reversal !== undefined ? t.bias_reversal : false,
                    trade_type: t.trade_type || "BREAKOUT",
                    account_id: targetAccountId,
                    created_at: t.created_at ? new Date(t.created_at) : new Date(),
                },
            });
            if (t.executions && Array.isArray(t.executions)) {
                for (const e of t.executions) {
                    await prisma.execution.create({
                        data: {
                            trade_id: newTrade.trade_id,
                            fill_price: Number(e.fill_price),
                            quantity: Number(e.quantity),
                            side: e.side,
                            execution_timestamp: e.execution_timestamp ? new Date(e.execution_timestamp) : new Date(),
                        },
                    });
                }
            }
            if (t.trade_tags && Array.isArray(t.trade_tags)) {
                for (const tt of t.trade_tags) {
                    const tagName = tt.tag ? tt.tag.tag_name : tt.tag_name;
                    if (tagName) {
                        let tag = await prisma.tag.findUnique({ where: { tag_name: tagName } });
                        if (!tag) {
                            tag = await prisma.tag.create({
                                data: { tag_name: tagName, tag_category: tt.tag?.tag_category || "Setup", color_code: tt.tag?.color_code || "#00e5ff" },
                            });
                        }
                        await prisma.tradeTag.create({
                            data: { trade_id: newTrade.trade_id, tag_id: tag.tag_id },
                        });
                    }
                }
            }
            if (t.market_context && Array.isArray(t.market_context)) {
                for (const mc of t.market_context) {
                    await prisma.marketContext.create({
                        data: {
                            trade_id: newTrade.trade_id,
                            regime_type: mc.regime_type,
                            vix_level: Number(mc.vix_level),
                            fed_funds_rate: Number(mc.fed_funds_rate),
                            spx_trend: mc.spx_trend,
                        },
                    });
                }
            }
            else {
                await prisma.marketContext.create({
                    data: {
                        trade_id: newTrade.trade_id,
                        regime_type: currentMarketRegime.regime_type,
                        vix_level: currentMarketRegime.vix_level,
                        fed_funds_rate: currentMarketRegime.fed_funds_rate,
                        spx_trend: currentMarketRegime.spx_trend,
                    },
                });
            }
            await updateTradeCalculations(newTrade.trade_id);
            importedTrades.push(newTrade);
        }
        broadcast({ type: "TRADES_IMPORTED", count: importedTrades.length });
        res.json({ success: true, count: importedTrades.length });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.patch("/api/executions/:executionId", async (req, res) => {
    const { executionId } = req.params;
    const { fill_price, quantity, side, execution_timestamp } = req.body;
    try {
        const execution = await prisma.execution.findUnique({
            where: { execution_id: executionId },
        });
        if (!execution) {
            return res.status(404).json({ error: "Execution not found" });
        }
        if (fill_price !== undefined) {
            const p = Number(fill_price);
            if (isNaN(p) || p <= 0) {
                return res.status(400).json({ error: "Price must be a positive number greater than zero." });
            }
        }
        if (quantity !== undefined) {
            const q = Number(quantity);
            if (isNaN(q) || q <= 0) {
                return res.status(400).json({ error: "Quantity must be a positive number greater than zero." });
            }
        }
        const updatedExecution = await prisma.execution.update({
            where: { execution_id: executionId },
            data: {
                fill_price: fill_price !== undefined ? Number(fill_price) : execution.fill_price,
                quantity: quantity !== undefined ? Number(quantity) : execution.quantity,
                side: side !== undefined ? side : execution.side,
                execution_timestamp: execution_timestamp ? new Date(execution_timestamp) : execution.execution_timestamp,
            },
        });
        await updateTradeCalculations(execution.trade_id);
        const updatedTrade = await prisma.trade.findUnique({
            where: { trade_id: execution.trade_id },
            include: { executions: true, trade_tags: { include: { tag: true } }, market_context: true },
        });
        res.json(updatedExecution);
        broadcast({ type: "TRADE_UPDATED", trade: updatedTrade });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.delete("/api/executions/:executionId", async (req, res) => {
    const { executionId } = req.params;
    try {
        const execution = await prisma.execution.findUnique({
            where: { execution_id: executionId },
        });
        if (!execution) {
            return res.status(404).json({ error: "Execution not found" });
        }
        await prisma.execution.delete({
            where: { execution_id: executionId },
        });
        await updateTradeCalculations(execution.trade_id);
        const updatedTrade = await prisma.trade.findUnique({
            where: { trade_id: execution.trade_id },
            include: { executions: true, trade_tags: { include: { tag: true } }, market_context: true },
        });
        res.json({ success: true });
        broadcast({ type: "TRADE_UPDATED", trade: updatedTrade });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * ----------------------------------------------------
 * STATS & DASHBOARD ENDPOINTS
 * ----------------------------------------------------
 */
app.get("/api/stats/:accountId", async (req, res) => {
    const { accountId } = req.params;
    try {
        const account = await prisma.account.findUnique({
            where: { account_id: accountId },
        });
        if (!account) {
            return res.status(404).json({ error: "Account not found" });
        }
        const trades = await prisma.trade.findMany({
            where: { account_id: accountId },
            include: { executions: true, trade_tags: { include: { tag: true } }, market_context: true },
        });
        const metrics = (0, metrics_1.calculateMetrics)(trades, Number(account.initial_balance));
        res.json(metrics);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * ----------------------------------------------------
 * PLAYBOOKS & TAGS ENDPOINTS
 * ----------------------------------------------------
 */
app.get("/api/playbooks", async (req, res) => {
    try {
        const playbooks = await prisma.playbook.findMany();
        res.json(playbooks);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post("/api/playbooks", async (req, res) => {
    const { setup_name, description, ruleset_json } = req.body;
    try {
        let defaultUser = await prisma.user.findFirst();
        if (!defaultUser) {
            defaultUser = await prisma.user.create({
                data: { email: "trader@journal.com", password_hash: "demo", subscription_tier: "ELITE" },
            });
        }
        const playbook = await prisma.playbook.create({
            data: {
                setup_name,
                description,
                ruleset_json: JSON.stringify(ruleset_json || {}),
                user_id: defaultUser.user_id,
            },
        });
        res.json(playbook);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.get("/api/tags", async (req, res) => {
    try {
        const tags = await prisma.tag.findMany();
        res.json(tags);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post("/api/tags", async (req, res) => {
    const { tag_name, tag_category, color_code } = req.body;
    try {
        const tag = await prisma.tag.create({
            data: { tag_name, tag_category, color_code: color_code || "#4a7898" },
        });
        res.json(tag);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * ----------------------------------------------------
 * MARKET REGIME POSTING (Updated by Python ML script)
 * ----------------------------------------------------
 */
app.post("/api/market/regime", (req, res) => {
    currentMarketRegime = { ...currentMarketRegime, ...req.body };
    res.json({ status: "success", currentMarketRegime });
    broadcast({ type: "REGIME_SHIFT", regime: currentMarketRegime });
});
app.get("/api/market/regime", (req, res) => {
    res.json(currentMarketRegime);
});
/**
 * ----------------------------------------------------
 * AI COACH (SSE Chat Streaming Endpoint)
 * ----------------------------------------------------
 */
app.get("/api/ai/coach", async (req, res) => {
    const { accountId, query, reconciliationReport, model } = req.query;
    if (!accountId || !query) {
        return res.status(400).json({ error: "accountId and query parameters are required" });
    }
    // Set SSE Headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    // Keep-alive heartbeat ticker to prevent socket closure
    const keepAlive = setInterval(() => {
        res.write(":\n\n");
    }, 15000);
    // Save the user message to ChatMessage table
    try {
        await prisma.chatMessage.create({
            data: {
                role: "user",
                content: String(query),
                account_id: String(accountId),
            },
        });
    }
    catch (e) {
        console.error("Failed to save user chat log:", e);
    }
    try {
        await (0, aiRouter_1.streamAICoach)(String(accountId), String(query), reconciliationReport ? String(reconciliationReport) : null, model ? String(model) : null, (token) => {
            // Send SSE message block
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }, async (fullText) => {
            // Save the assistant message to ChatMessage table on completion
            try {
                await prisma.chatMessage.create({
                    data: {
                        role: "assistant",
                        content: fullText,
                        account_id: String(accountId),
                    },
                });
            }
            catch (e) {
                console.error("Failed to save assistant chat log:", e);
            }
            res.write(`data: ${JSON.stringify({ complete: true, fullText })}\n\n`);
            clearInterval(keepAlive);
            res.end();
        });
    }
    catch (error) {
        console.error(error);
        res.write(`data: ${JSON.stringify({ token: `Error processing coach: ${error.message}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ complete: true })}\n\n`);
        clearInterval(keepAlive);
        res.end();
    }
});
// Endpoint to fetch available models
app.get("/api/ai/models", async (req, res) => {
    try {
        const models = await (0, aiRouter_1.getAvailableModels)();
        res.json(models);
    }
    catch (error) {
        console.error("Failed to fetch AI models:", error);
        res.status(500).json({ error: error.message });
    }
});
// Endpoint to fetch chat message history for an account
app.get("/api/ai/chats", async (req, res) => {
    const { accountId } = req.query;
    if (!accountId) {
        return res.status(400).json({ error: "accountId is required" });
    }
    try {
        const chats = await prisma.chatMessage.findMany({
            where: { account_id: String(accountId) },
            orderBy: { created_at: "asc" },
        });
        res.json(chats);
    }
    catch (error) {
        console.error("Failed to fetch chat logs:", error);
        res.status(500).json({ error: error.message });
    }
});
// Endpoint to clear/delete chat history for an account
app.delete("/api/ai/chats", async (req, res) => {
    const { accountId } = req.query;
    if (!accountId) {
        return res.status(400).json({ error: "accountId is required" });
    }
    try {
        await prisma.chatMessage.deleteMany({
            where: { account_id: String(accountId) },
        });
        res.json({ success: true, message: "Chat history cleared successfully" });
    }
    catch (error) {
        console.error("Failed to clear chat logs:", error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * Helper: Parses raw Ironbeam statement text fills list
 */
function parseIronbeamFills(rawText) {
    const lines = rawText.split("\n");
    const parsedExecutions = [];
    for (const line of lines) {
        const cleanLine = line.toUpperCase().trim();
        if (!cleanLine)
            continue;
        // Regex matching standard futures fill pattern
        // e.g. BUY 2 ES M6 5120.00 05/22 10:24:12
        const regex = /(BUY|SELL|BOT|SLD)\s+(\d+)\s+([A-Z0-9\s]+?)\s+(\d+(?:\.\d+)?)\s+(?:(?:\d{2}\/\d{2})\s+)?(\d{2}:\d{2}:\d{2})/;
        const match = cleanLine.match(regex);
        if (match) {
            const sideRaw = match[1];
            const side = (sideRaw === "BUY" || sideRaw === "BOT") ? "BUY" : "SELL";
            const quantity = parseInt(match[2], 10);
            const symbolRaw = match[3];
            const fillPrice = parseFloat(match[4]);
            const timeStr = match[5];
            // Futures symbol normalization
            let symbol = symbolRaw;
            if (symbolRaw.startsWith("ES"))
                symbol = "ES";
            else if (symbolRaw.startsWith("NQ"))
                symbol = "NQ";
            else if (symbolRaw.startsWith("RTY"))
                symbol = "RTY";
            else if (symbolRaw.startsWith("YM"))
                symbol = "YM";
            const dateStr = new Date().toLocaleDateString();
            const timestamp = new Date(`${dateStr} ${timeStr}`);
            parsedExecutions.push({ side, symbol, quantity, fillPrice, timestamp });
        }
    }
    if (parsedExecutions.length === 0) {
        // Fallback: If regex fails to find matches, try a simple whitespace split
        lines.forEach((line) => {
            const parts = line.split(/[,\t\s]+/);
            if (parts.length >= 4) {
                const sideCandidate = parts[0].toUpperCase();
                const side = (sideCandidate.startsWith("B") || sideCandidate.startsWith("BUY") || sideCandidate.startsWith("BOT")) ? "BUY" : (sideCandidate.startsWith("S") || sideCandidate.startsWith("SELL") || sideCandidate.startsWith("SLD")) ? "SELL" : null;
                const qty = parseInt(parts[1], 10);
                const symbolRaw = parts[2].toUpperCase();
                const price = parseFloat(parts[3]);
                if (side && !isNaN(qty) && symbolRaw && !isNaN(price)) {
                    let symbol = symbolRaw;
                    if (symbolRaw.startsWith("ES"))
                        symbol = "ES";
                    else if (symbolRaw.startsWith("NQ"))
                        symbol = "NQ";
                    else if (symbolRaw.startsWith("RTY"))
                        symbol = "RTY";
                    else if (symbolRaw.startsWith("YM"))
                        symbol = "YM";
                    parsedExecutions.push({
                        side,
                        symbol,
                        quantity: qty,
                        fillPrice: price,
                        timestamp: new Date(),
                    });
                }
            }
        });
    }
    return parsedExecutions;
}
/**
 * ----------------------------------------------------
 * PHASE 2: COMPARATIVE RECONCILIATION & SYNC ENDPOINTS
 * ----------------------------------------------------
 */
app.post("/api/ingest/ironbeam/analyze", async (req, res) => {
    const { rawText, account_id } = req.body;
    if (!rawText || !account_id) {
        return res.status(400).json({ error: "rawText and account_id are required" });
    }
    try {
        const parsedExecutions = parseIronbeamFills(rawText);
        if (parsedExecutions.length === 0) {
            return res.status(422).json({
                error: "Could not parse any executions. Ensure fills list contains: Side (Buy/Sell), Quantity, Symbol, Price, and Time.",
            });
        }
        // Fetch manual trades from the last 48 hours
        const sinceDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const manualTrades = await prisma.trade.findMany({
            where: {
                account_id,
                created_at: { gte: sinceDate },
            },
            include: {
                executions: true,
            },
        });
        const manualExecs = [];
        manualTrades.forEach((t) => {
            t.executions.forEach((e) => {
                let sym = t.symbol.toUpperCase();
                if (sym.startsWith("ES"))
                    sym = "ES";
                else if (sym.startsWith("NQ"))
                    sym = "NQ";
                else if (sym.startsWith("RTY"))
                    sym = "RTY";
                else if (sym.startsWith("YM"))
                    sym = "YM";
                manualExecs.push({
                    execution_id: e.execution_id,
                    side: e.side,
                    fill_price: Number(e.fill_price),
                    quantity: Number(e.quantity),
                    execution_timestamp: e.execution_timestamp,
                    trade_id: t.trade_id,
                    symbol: sym,
                });
            });
        });
        const matched = [];
        const ghosts = [];
        const pairedManualExecIds = new Set();
        for (const stmt of parsedExecutions) {
            let bestMatch = null;
            let minTimeDiff = Infinity;
            for (const m of manualExecs) {
                if (pairedManualExecIds.has(m.execution_id))
                    continue;
                if (m.symbol !== stmt.symbol)
                    continue;
                if (m.side !== stmt.side)
                    continue;
                const timeDiff = Math.abs(m.execution_timestamp.getTime() - stmt.timestamp.getTime());
                if (timeDiff < minTimeDiff) {
                    minTimeDiff = timeDiff;
                    bestMatch = m;
                }
            }
            // If time difference is within a reasonable window (e.g. 2 hours)
            if (bestMatch && minTimeDiff < 2 * 60 * 60 * 1000) {
                pairedManualExecIds.add(bestMatch.execution_id);
                let slippage = 0;
                if (stmt.side === "BUY") {
                    slippage = bestMatch.fill_price - stmt.fillPrice;
                }
                else {
                    slippage = stmt.fillPrice - bestMatch.fill_price;
                }
                matched.push({
                    statement: stmt,
                    manual: {
                        execution_id: bestMatch.execution_id,
                        trade_id: bestMatch.trade_id,
                        side: bestMatch.side,
                        quantity: bestMatch.quantity,
                        fill_price: bestMatch.fill_price,
                        timestamp: bestMatch.execution_timestamp,
                        symbol: bestMatch.symbol,
                    },
                    slippage,
                });
            }
            else {
                ghosts.push(stmt);
            }
        }
        const orphans = manualExecs.filter((m) => !pairedManualExecIds.has(m.execution_id));
        res.json({
            summary: {
                totalStatementExecutions: parsedExecutions.length,
                totalManualExecutions: manualExecs.length,
                matchedCount: matched.length,
                ghostCount: ghosts.length,
                orphanCount: orphans.length,
                totalSlippage: matched.reduce((sum, m) => sum + m.slippage, 0),
            },
            matched,
            ghosts,
            orphans,
        });
    }
    catch (error) {
        console.error("Reconciliation analysis error:", error);
        res.status(500).json({ error: error.message });
    }
});
app.post("/api/ingest/ironbeam/sync", async (req, res) => {
    const { account_id, initial_risk, matched, ghosts } = req.body;
    if (!account_id) {
        return res.status(400).json({ error: "account_id is required" });
    }
    try {
        const updatedTradeIds = new Set();
        // 1. Sync Matched Executions (enrich with actual fill price & time)
        if (matched && Array.isArray(matched)) {
            for (const m of matched) {
                const { manual, statement } = m;
                await prisma.execution.update({
                    where: { execution_id: manual.execution_id },
                    data: {
                        fill_price: statement.fillPrice,
                        execution_timestamp: new Date(statement.timestamp),
                    },
                });
                updatedTradeIds.add(manual.trade_id);
            }
        }
        // 2. Create unjournaled ghost executions
        if (ghosts && Array.isArray(ghosts)) {
            for (const g of ghosts) {
                let trade = await prisma.trade.findFirst({
                    where: {
                        account_id,
                        symbol: g.symbol,
                        status: "OPEN",
                    },
                });
                if (!trade) {
                    trade = await prisma.trade.create({
                        data: {
                            symbol: g.symbol,
                            account_id,
                            notes: `Auto-created unjournaled trade from Ironbeam statement.`,
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
                }
                await prisma.execution.create({
                    data: {
                        trade_id: trade.trade_id,
                        fill_price: g.fillPrice,
                        quantity: g.quantity,
                        side: g.side,
                        execution_timestamp: new Date(g.timestamp),
                    },
                });
                updatedTradeIds.add(trade.trade_id);
            }
        }
        // 3. Recalculate metrics for all affected trades
        const risk = initial_risk ? Number(initial_risk) : 100;
        for (const tradeId of updatedTradeIds) {
            await updateTradeCalculations(tradeId, risk);
        }
        broadcast({ type: "IRONBEAM_PARSED", count: (matched?.length || 0) + (ghosts?.length || 0) });
        res.json({
            success: true,
            message: `Successfully synchronized ${matched?.length || 0} matched executions and ${ghosts?.length || 0} ghost executions.`,
        });
    }
    catch (error) {
        console.error("Sync statement error:", error);
        res.status(500).json({ error: error.message });
    }
});
// Upload a chart screenshot
app.post("/api/charts/upload", async (req, res) => {
    const { accountId, dateStr, imageData } = req.body;
    if (!accountId || !dateStr || !imageData) {
        return res.status(400).json({ error: "accountId, dateStr, and imageData are required" });
    }
    try {
        // 1. Validate and parse base64 image
        const matches = imageData.match(/^data:image\/([A-Za-z-+]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return res.status(400).json({ error: "Invalid image base64 format" });
        }
        const extension = matches[1];
        const imageBuffer = Buffer.from(matches[2], "base64");
        // 2. Generate unique filename and write to disk
        const cleanDate = dateStr.replace(/\//g, "-").replace(/:/g, "-");
        const filename = `${accountId}_${cleanDate}_${Date.now()}.${extension}`;
        const filePath = path_1.default.join(uploadsDir, filename);
        fs_1.default.writeFileSync(filePath, imageBuffer);
        // 3. Save to database
        const relativePath = `/uploads/${filename}`;
        const chart = await prisma.dailyChart.create({
            data: {
                date_str: dateStr,
                image_path: relativePath,
                account_id: accountId,
            },
        });
        res.json(chart);
    }
    catch (error) {
        console.error("Failed to upload chart:", error);
        res.status(500).json({ error: error.message });
    }
});
// Get all chart screenshots for a day
app.get("/api/charts", async (req, res) => {
    const { accountId, dateStr } = req.query;
    if (!accountId || !dateStr) {
        return res.status(400).json({ error: "accountId and dateStr are required" });
    }
    try {
        const charts = await prisma.dailyChart.findMany({
            where: {
                account_id: String(accountId),
                date_str: String(dateStr),
            },
            orderBy: { created_at: "asc" },
        });
        res.json(charts);
    }
    catch (error) {
        console.error("Failed to fetch daily charts:", error);
        res.status(500).json({ error: error.message });
    }
});
// Delete a chart screenshot
app.delete("/api/charts/:chartId", async (req, res) => {
    const { chartId } = req.params;
    try {
        const chart = await prisma.dailyChart.findUnique({
            where: { chart_id: chartId },
        });
        if (!chart) {
            return res.status(404).json({ error: "Chart not found" });
        }
        // Delete file from disk
        const filename = path_1.default.basename(chart.image_path);
        const filePath = path_1.default.join(uploadsDir, filename);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
        }
        // Delete from database
        await prisma.dailyChart.delete({
            where: { chart_id: chartId },
        });
        res.json({ success: true, message: "Chart screenshot deleted" });
    }
    catch (error) {
        console.error("Failed to delete chart:", error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * ----------------------------------------------------
 * ACCOUNT CUSTOMIZATION
 * ----------------------------------------------------
 */
app.patch("/api/accounts/:accountId", async (req, res) => {
    const { accountId } = req.params;
    const { account_name, broker_name, initial_balance } = req.body;
    try {
        const updatedAccount = await prisma.account.update({
            where: { account_id: accountId },
            data: {
                account_name,
                broker_name,
                initial_balance: initial_balance !== undefined ? Number(initial_balance) : undefined,
            },
        });
        res.json(updatedAccount);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * ----------------------------------------------------
 * HMM REGIME BACKGROUND PIPELINE
 * ----------------------------------------------------
 */
function runHMMClassifier() {
    const pythonExe = path_1.default.resolve(__dirname, "../../ml_pipeline/.venv/Scripts/python.exe");
    const scriptFile = path_1.default.resolve(__dirname, "../../ml_pipeline/regime_classifier.py");
    console.log(`Spawning HMM classifier: ${pythonExe} ${scriptFile}`);
    const py = (0, child_process_1.spawn)(pythonExe, [scriptFile]);
    py.stdout.on("data", (data) => {
        console.log(`HMM stdout: ${data}`);
    });
    py.stderr.on("data", (data) => {
        console.error(`HMM stderr: ${data}`);
    });
    py.on("close", (code) => {
        console.log(`HMM process completed with code ${code}`);
    });
}
app.post("/api/market/regime/trigger", (req, res) => {
    try {
        runHMMClassifier();
        res.json({ success: true, message: "HMM regime classification task triggered." });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// Schedule daily HMM run at midnight
node_cron_1.default.schedule("0 0 * * *", () => {
    console.log("Cron triggering daily HMM run...");
    runHMMClassifier();
});
/**
 * ----------------------------------------------------
 * WEEKLY PERFORMANCE AUDITS (ON-DEMAND / SUGGESTIONS)
 * ----------------------------------------------------
 */
async function generateWeeklyAuditReport(accountId, startDate, endDate) {
    const account = await prisma.account.findUnique({
        where: { account_id: accountId },
    });
    if (!account)
        throw new Error("Account not found");
    const trades = await prisma.trade.findMany({
        where: {
            account_id: accountId,
            created_at: {
                gte: startDate,
                lte: endDate,
            },
        },
        include: { executions: true, trade_tags: { include: { tag: true } }, market_context: true },
    });
    const metrics = (0, metrics_1.calculateMetrics)(trades, Number(account.initial_balance));
    const tradeSummaryList = trades.map((t) => {
        const tags = t.trade_tags.map(tt => tt.tag.tag_name).join(", ");
        return `- Trade: ${t.symbol} | P&L: $${Number(t.net_pnl).toFixed(2)} | Rules Followed: ${t.rules_followed ? "YES" : "NO"} | Tags: ${tags || "None"} | Notes: ${t.notes || "None"}`;
    }).join("\n");
    const prompt = `
Generate a Weekly Performance Audit report for the trader.
Account Name: ${account.account_name} (${account.broker_name})
Date Range: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}

Weekly Metrics:
- Total Closed Trades: ${metrics.totalTrades}
- Win Rate: ${(metrics.winRate * 100).toFixed(1)}%
- Profit Factor: ${metrics.profitFactor.toFixed(2)}
- Net P&L: $${trades.reduce((acc, t) => acc + Number(t.net_pnl), 0).toFixed(2)}
- Expectancy (R): +${metrics.expectancyR.toFixed(2)}R
- Rule Adherence Rate: ${(metrics.ruleAdherenceRate * 100).toFixed(1)}%
- Cost of Indiscipline: $${metrics.costOfIndiscipline.toFixed(2)}

Weekly Trades Log:
${tradeSummaryList || "No trades logged in this period."}

Format the report beautifully in Markdown. Include:
1. **Weekly Overview**: A summary of key statistics and performance.
2. **Behavioral Analysis**: Audit of rules followed and cost of indiscipline. (If they broke rules, give them a gentle nudge on how discipline is key. Celebrate if they had 100% adherence!)
3. **Setup and Regime Performance**: Analyze which setups or tags performed best under current market states.
4. **Actionable Roadmap**: Clear adjustments for the next week (e.g. position sizing, tag-specific rules).
`;
    const baseURL = process.env.OPENAI_BASE_URL || "http://localhost:1234/v1";
    const apiKey = process.env.OPENAI_API_KEY || "lm-studio";
    const openaiClient = new openai_1.OpenAI({ baseURL, apiKey });
    const models = await (0, aiRouter_1.getAvailableModels)();
    const selectedModel = process.env.LLM_MODEL || models[0] || "local-model";
    const completion = await openaiClient.chat.completions.create({
        model: selectedModel,
        messages: [
            { role: "system", content: "You are the Antigravity Quantitative Trading Coach. Provide a detailed, constructive weekly performance audit formatted in clean Markdown." },
            { role: "user", content: prompt }
        ],
        temperature: 0.3,
    });
    const summary_md = completion.choices[0]?.message?.content || "Failed to generate weekly report.";
    const report = await prisma.weeklyReport.create({
        data: {
            account_id: accountId,
            start_date: startDate,
            end_date: endDate,
            summary_md,
        },
    });
    broadcast({ type: "WEEKLY_REPORT_GENERATED", report });
    return report;
}
app.get("/api/weekly-reports", async (req, res) => {
    const { accountId } = req.query;
    try {
        const reports = await prisma.weeklyReport.findMany({
            where: accountId ? { account_id: String(accountId) } : undefined,
            orderBy: { created_at: "desc" },
        });
        res.json(reports);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
app.post("/api/weekly-reports/trigger", async (req, res) => {
    const { accountId, startDate, endDate } = req.body;
    if (!accountId) {
        return res.status(400).json({ error: "accountId is required." });
    }
    try {
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();
        const report = await generateWeeklyAuditReport(accountId, start, end);
        res.json(report);
    }
    catch (error) {
        console.error("Weekly report generation failed:", error);
        res.status(500).json({ error: error.message });
    }
});
// Schedule weekly audit alert on Friday at 5 PM (Suggesting it over Websockets)
node_cron_1.default.schedule("0 17 * * 5", async () => {
    console.log("Cron triggering weekly audit recommendation...");
    try {
        const accounts = await prisma.account.findMany();
        for (const acc of accounts) {
            broadcast({
                type: "AUDIT_SUGGESTION",
                account_id: acc.account_id,
                message: "The trading week has wrapped up! Click here to generate your Weekly Performance Audit.",
            });
        }
    }
    catch (err) {
        console.error("Error sending weekly audit alerts:", err);
    }
});
// Initialize server
server.listen(PORT, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
});
