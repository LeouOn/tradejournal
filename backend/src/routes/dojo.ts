import { Router } from "express";
import yahooFinance from "yahoo-finance2";

const dojoRouter = Router();

// In-memory cache for API responses to avoid rate limits
// Key: "TICKER:YYYY-MM-DD:YYYY-MM-DD"
// Value: { data: OHLCV[], expiresAt: number }
const cache = new Map<string, { data: any[]; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const TICKERS = ["SPY", "QQQ", "AAPL", "MSFT", "TSLA", "NVDA", "AMZN", "META", "GOOGL", "NFLX"];

// Helper to clear expired cache entries
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt < now) {
      cache.delete(key);
    }
  }
}

// 1 day in ms
const DAY_MS = 24 * 60 * 60 * 1000;

dojoRouter.get("/scenario", async (req, res) => {
  cleanCache();

  try {
    const symbol = TICKERS[Math.floor(Math.random() * TICKERS.length)];
    
    // Random date within the last 3 years, ensuring at least 6 months of buffer at the end
    // so we don't accidentally pick "today" as the start and have no reveal data.
    const now = Date.now();
    const threeYearsAgo = now - (3 * 365 * DAY_MS);
    const sixMonthsAgo = now - (180 * DAY_MS);
    
    const randomStartTime = threeYearsAgo + Math.random() * (sixMonthsAgo - threeYearsAgo);
    // Fetch roughly 6 months of data starting from randomStartTime to ensure we get >= 80 trading days
    const randomEndTime = randomStartTime + (180 * DAY_MS);

    const period1 = new Date(randomStartTime).toISOString().split("T")[0];
    const period2 = new Date(randomEndTime).toISOString().split("T")[0];

    const cacheKey = `${symbol}:${period1}:${period2}`;
    
    let rawData: any[] = [];

    if (cache.has(cacheKey)) {
      rawData = cache.get(cacheKey)!.data;
    } else {
      const queryOptions = { period1, period2, interval: "1d" as const };
      const result = (await yahooFinance.historical(symbol, queryOptions)) as any[];
      
      rawData = result.map((item: any) => {
        // lightweight-charts expects time as "YYYY-MM-DD" string for daily charts
        const timeStr = item.date.toISOString().split("T")[0];
        return {
          time: timeStr,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume
        };
      });

      cache.set(cacheKey, { data: rawData, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    // We need exactly 80 trading days for the game
    if (rawData.length < 80) {
      // Very rare (e.g. recent IPO, or weird date boundary), but let the client retry
      return res.status(500).json({ error: "Insufficient trading days returned, please retry." });
    }

    // Slice exactly 80 items
    const gameData = rawData.slice(0, 80);
    const setup = gameData.slice(0, 60);
    const reveal = gameData.slice(60, 80);

    res.json({
      symbol,
      period1,
      period2,
      setup,
      reveal
    });
  } catch (error) {
    console.error("Dojo Scenario Error:", error);
    res.status(500).json({ error: "Failed to fetch scenario data" });
  }
});

export default dojoRouter;
