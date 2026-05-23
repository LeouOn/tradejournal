import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { generateEmbedding, streamAICoach } from "./services/aiRouter";
import { calculateMetrics } from "./utils/metrics";
import { getSymbolMultiplier, validatePriceProximity } from "./utils/multipliers";

dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const prisma = new PrismaClient();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Active WebSocket connections
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`WebSocket client connected. Total: ${clients.size}`);
  
  ws.on("close", () => {
    clients.delete(ws);
    console.log(`WebSocket client disconnected. Total: ${clients.size}`);
  });
});

// Helper: Broadcast to all connected WebSocket clients
function broadcast(data: any) {
  const payload = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Current market regime state (global cache, updated by HMM script or manually)
let currentMarketRegime: Record<string, any> = {
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

/**
 * ----------------------------------------------------
 * ACCOUNTS ENDPOINTS
 * ----------------------------------------------------
 */
app.get("/api/accounts", async (req, res) => {
  try {
    const accounts = await prisma.account.findMany();
    res.json(accounts);
  } catch (error: any) {
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
  } catch (error: any) {
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: Recalculate average fill prices, net realized P&L, status, and duration
async function updateTradeCalculations(tradeId: string, initialRisk = 100) {
  const trade = await prisma.trade.findUnique({
    where: { trade_id: tradeId },
    include: { executions: true },
  });

  if (!trade) return;

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

  const executions = trade.executions.sort(
    (a, b) => a.execution_timestamp.getTime() - b.execution_timestamp.getTime()
  );

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
      // Long: P&L = (Exit - Entry) * Qty * Multiplier
      netPnl = (avgExitPrice - avgEntryPrice) * totalExitQty * multiplier;
    } else {
      // Short: P&L = (Entry - Exit) * Qty * Multiplier
      netPnl = (avgEntryPrice - avgExitPrice) * totalExitQty * multiplier;
    }
  }

  // Auto-close if exited quantity matches/exceeds entered quantity (always forces CLOSED)
  let status = trade.status;
  if (totalExitQty >= totalEntryQty) {
    status = "CLOSED";
  } else {
    if (!trade.manual_status) {
      status = "OPEN";
    }
  }

  // R-Multiple
  const rMultiple = initialRisk > 0 ? netPnl / initialRisk : 0;

  // Duration
  let duration = 0;
  if (executions.length > 1) {
    duration = Math.round(
      (executions[executions.length - 1].execution_timestamp.getTime() -
        executions[0].execution_timestamp.getTime()) /
        1000
    );
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
  const { symbol, account_id, initial_risk, rules_followed, notes, tags, status, manual_status, bias, bias_reversal, trade_type } = req.body;
  try {
    // 1. Generate text embedding for qualitative notes in background
    let embeddingStr: string | null = null;
    if (notes && notes.trim() !== "") {
      const vec = await generateEmbedding(notes);
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
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Update trade fields (e.g. status, notes, tags, rules_followed, initial risk)
app.patch("/api/trades/:tradeId", async (req, res) => {
  const { tradeId } = req.params;
  const { status, manual_status, notes, rules_followed, tags, initial_risk, bias, bias_reversal, trade_type } = req.body;
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
        const vec = await generateEmbedding(notes);
        embeddingStr = JSON.stringify(vec);
      } else {
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
  } catch (error: any) {
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
      const { isValid, percentageDelta } = validatePriceProximity(firstPrice, newPrice);
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/trades/:tradeId", async (req, res) => {
  const { tradeId } = req.params;
  try {
    await prisma.trade.delete({ where: { trade_id: tradeId } });
    res.json({ success: true });
    broadcast({ type: "TRADE_DELETED", trade_id: tradeId });
  } catch (error: any) {
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
  } catch (error: any) {
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
      } else {
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
  } catch (error: any) {
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
  } catch (error: any) {
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
  } catch (error: any) {
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

    const metrics = calculateMetrics(trades, Number(account.initial_balance));
    res.json(metrics);
  } catch (error: any) {
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
  } catch (error: any) {
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/tags", async (req, res) => {
  try {
    const tags = await prisma.tag.findMany();
    res.json(tags);
  } catch (error: any) {
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
  } catch (error: any) {
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
  const { accountId, query, reconciliationReport } = req.query;

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

  try {
    await streamAICoach(
      String(accountId),
      String(query),
      reconciliationReport ? String(reconciliationReport) : null,
      (token) => {
        // Send SSE message block
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      },
      (fullText) => {
        res.write(`data: ${JSON.stringify({ complete: true, fullText })}\n\n`);
        clearInterval(keepAlive);
        res.end();
      }
    );
  } catch (error: any) {
    console.error(error);
    res.write(`data: ${JSON.stringify({ token: `Error processing coach: ${error.message}` })}\n\n`);
    res.write(`data: ${JSON.stringify({ complete: true })}\n\n`);
    clearInterval(keepAlive);
    res.end();
  }
});

/**
 * Helper: Parses raw Ironbeam statement text fills list
 */
function parseIronbeamFills(rawText: string): {
  side: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  fillPrice: number;
  timestamp: Date;
}[] {
  const lines = rawText.split("\n");
  const parsedExecutions: {
    side: "BUY" | "SELL";
    symbol: string;
    quantity: number;
    fillPrice: number;
    timestamp: Date;
  }[] = [];

  for (const line of lines) {
    const cleanLine = line.toUpperCase().trim();
    if (!cleanLine) continue;

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
      if (symbolRaw.startsWith("ES")) symbol = "ES";
      else if (symbolRaw.startsWith("NQ")) symbol = "NQ";
      else if (symbolRaw.startsWith("RTY")) symbol = "RTY";
      else if (symbolRaw.startsWith("YM")) symbol = "YM";

      const dateStr = new Date().toLocaleDateString();
      const timestamp = new Date(`${dateStr} ${timeStr}`);

      parsedExecutions.push({ side, symbol, quantity, fillPrice, timestamp });
    }
  }

  if (parsedExecutions.length === 0) {
    // Fallback: If regex fails to find matches, try a simple whitespace split
    lines.forEach((line: string) => {
      const parts = line.split(/[,\t\s]+/);
      if (parts.length >= 4) {
        const sideCandidate = parts[0].toUpperCase();
        const side = (sideCandidate.startsWith("B") || sideCandidate.startsWith("BUY") || sideCandidate.startsWith("BOT")) ? "BUY" : (sideCandidate.startsWith("S") || sideCandidate.startsWith("SELL") || sideCandidate.startsWith("SLD")) ? "SELL" : null;
        const qty = parseInt(parts[1], 10);
        const symbolRaw = parts[2].toUpperCase();
        const price = parseFloat(parts[3]);
        if (side && !isNaN(qty) && symbolRaw && !isNaN(price)) {
          let symbol = symbolRaw;
          if (symbolRaw.startsWith("ES")) symbol = "ES";
          else if (symbolRaw.startsWith("NQ")) symbol = "NQ";
          else if (symbolRaw.startsWith("RTY")) symbol = "RTY";
          else if (symbolRaw.startsWith("YM")) symbol = "YM";

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

    interface ManualExecExt {
      execution_id: string;
      side: string;
      fill_price: number;
      quantity: number;
      execution_timestamp: Date;
      trade_id: string;
      symbol: string;
    }

    const manualExecs: ManualExecExt[] = [];
    manualTrades.forEach((t) => {
      t.executions.forEach((e) => {
        let sym = t.symbol.toUpperCase();
        if (sym.startsWith("ES")) sym = "ES";
        else if (sym.startsWith("NQ")) sym = "NQ";
        else if (sym.startsWith("RTY")) sym = "RTY";
        else if (sym.startsWith("YM")) sym = "YM";

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

    const matched: any[] = [];
    const ghosts: any[] = [];
    const pairedManualExecIds = new Set<string>();

    for (const stmt of parsedExecutions) {
      let bestMatch: ManualExecExt | null = null;
      let minTimeDiff = Infinity;

      for (const m of manualExecs) {
        if (pairedManualExecIds.has(m.execution_id)) continue;
        if (m.symbol !== stmt.symbol) continue;
        if (m.side !== stmt.side) continue;

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
        } else {
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
      } else {
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
  } catch (error: any) {
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
    const updatedTradeIds = new Set<string>();

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
  } catch (error: any) {
    console.error("Sync statement error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Initialize server
server.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
});
