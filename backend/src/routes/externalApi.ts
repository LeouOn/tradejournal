import express from "express";
import { PrismaClient } from "@prisma/client";
import { calculateMetrics } from "../utils/metrics";
import { generateEmbedding, getAvailableModels } from "../services/aiRouter";
import { OpenAI } from "openai";

const router = express.Router();
const prisma = new PrismaClient();

// Ensure the OPENAI_BASE_URL and API Key are setup for the coach summary
const baseURL = process.env.OPENAI_BASE_URL || "http://localhost:1234/v1";
const apiKey = process.env.OPENAI_API_KEY || "lm-studio";
const openai = new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser: false });

// Middleware to check API key
router.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const externalApiKey = process.env.EXTERNAL_API_KEY;

  if (!externalApiKey) {
    console.warn("EXTERNAL_API_KEY not set in environment. Allowing request for local testing.");
    return next();
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized. Missing Bearer token." });
  }

  const token = authHeader.split(" ")[1];
  if (token !== externalApiKey) {
    return res.status(403).json({ error: "Forbidden. Invalid API key." });
  }

  next();
});

// Helper to get stats safely
async function getAccountStats(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { account_id: accountId },
  });
  if (!account) throw new Error("Account not found");

  const trades = await prisma.trade.findMany({
    where: { account_id: accountId },
    include: { executions: true, trade_tags: { include: { tag: true } }, market_context: true },
  });

  const metrics = calculateMetrics(trades, Number(account.initial_balance));
  return { account, trades, metrics };
}

// 1. GET /api/external/v1/stats
router.get("/v1/stats", async (req, res) => {
  try {
    const accountId = (req.query.accountId as string) || "acc-1"; // default test account
    const { metrics } = await getAccountStats(accountId);
    
    res.json({
      zellaScore: metrics.zellaScore,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
      totalTrades: metrics.totalTrades,
      expectancyR: metrics.expectancyR,
      currentBalance: metrics.equityCurve[metrics.equityCurve.length - 1]?.balance || 0,
      dailyPnl: metrics.equityCurve.length > 1 ? metrics.equityCurve[metrics.equityCurve.length - 1].pnl : 0
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/external/v1/equity
router.get("/v1/equity", async (req, res) => {
  try {
    const accountId = (req.query.accountId as string) || "acc-1";
    const { metrics } = await getAccountStats(accountId);
    
    // Send just the array of data points for drawing the chart
    res.json(metrics.equityCurve);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. GET /api/external/v1/trades/recent
router.get("/v1/trades/recent", async (req, res) => {
  try {
    const accountId = (req.query.accountId as string) || "acc-1";
    const limit = Number(req.query.limit) || 10;
    
    const recentTrades = await prisma.trade.findMany({
      where: { account_id: accountId, status: "CLOSED" },
      orderBy: { created_at: "desc" },
      take: limit,
      include: { trade_tags: { include: { tag: true } } }
    });

    const mapped = recentTrades.map((t) => ({
      id: t.trade_id,
      symbol: t.symbol,
      pnl: Number(t.net_pnl),
      rMultiple: Number(t.r_multiple),
      bias: t.bias,
      setupType: t.trade_type,
      tags: t.trade_tags.map((tt) => tt.tag.tag_name),
      date: t.created_at
    }));

    res.json(mapped);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. GET /api/external/v1/ai/summary
router.get("/v1/ai/summary", async (req, res) => {
  try {
    const accountId = (req.query.accountId as string) || "acc-1";
    const { metrics } = await getAccountStats(accountId);

    const prompt = `Based on the following stats, provide a short 2-sentence performance summary for the trader to display on their Marketpulse dashboard:
Win Rate: ${(metrics.winRate * 100).toFixed(1)}%
Profit Factor: ${metrics.profitFactor.toFixed(2)}
Zella Score: ${metrics.zellaScore}/100
Recent P&L: $${metrics.equityCurve.length > 1 ? metrics.equityCurve[metrics.equityCurve.length - 1].pnl : 0}`;

    const models = await getAvailableModels();
    const selectedModel = process.env.LLM_MODEL || models[0] || "local-model";

    // Call OpenAI natively for a simple completion (not streaming)
    const completion = await openai.chat.completions.create({
      model: selectedModel,
      messages: [
        { role: "system", content: "You are an elite quantitative trading coach. Provide a concise, 2-sentence summary." },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
    });

    res.json({
      summary: completion.choices[0]?.message?.content || "Could not generate summary."
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: "AI summary failed." });
  }
});

let regimeUpdater: ((payload: any) => void) | null = null;

export function setRegimeUpdater(updater: (payload: any) => void) {
  regimeUpdater = updater;
}

// 5. POST /api/external/v1/market-update
router.post("/v1/market-update", (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid payload. Expected a JSON object." });
    }
    if (regimeUpdater) {
      regimeUpdater(payload);
      return res.json({ success: true, message: "Market regime updated successfully.", regime: payload });
    } else {
      return res.status(500).json({ error: "Regime updater not registered in the core server." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
