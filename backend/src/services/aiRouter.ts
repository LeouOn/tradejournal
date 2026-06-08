import { OpenAI } from "openai";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { calculateMetrics } from "../utils/metrics";
import { updateTradeCalculations } from "../server";

dotenv.config();

const prisma = new PrismaClient();

// Initialize OpenAI client pointing to either LM Studio (localhost:1234) or OpenAI Cloud
const baseURL = process.env.OPENAI_BASE_URL || "http://localhost:1234/v1";
const apiKey = process.env.OPENAI_API_KEY || "lm-studio";

const openai = new OpenAI({
  baseURL,
  apiKey,
  dangerouslyAllowBrowser: false, // Node context
});

/**
 * Computes cosine similarity between two vector arrays
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generates vector embeddings for a given string.
 * Falls back to a deterministic pseudo-vector if the API is unavailable
 * to ensure the app continues to function smoothly without LLM server running.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim() === "") {
    return new Array(384).fill(0);
  }

  try {
    const response = await openai.embeddings.create({
      model: process.env.LLM_MODEL || "text-embedding-3-small", // or whatever is loaded locally
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.warn("Failed to generate embedding via LLM API, using deterministic hash fallback:", error);
    // Generate a simple, deterministic pseudo-vector of 384 dimensions
    const vec: number[] = [];
    const cleanText = text.toLowerCase().trim();
    for (let i = 0; i < 384; i++) {
      let hash = 0;
      for (let j = 0; j < cleanText.length; j++) {
        hash = (hash << 5) - hash + cleanText.charCodeAt(j) + i;
        hash = hash & hash; // Convert to 32bit integer
      }
      vec.push(Math.sin(hash) * 0.5); // Normalized range
    }
    return vec;
  }
}

/**
 * Dynamically queries loaded models from LM Studio / OpenAI
 */
export async function getAvailableModels(): Promise<string[]> {
  // If we are pointing to LM Studio port 1234, try the native LM Studio v1 endpoint first
  if (baseURL.includes("localhost:1234") || baseURL.includes("127.0.0.1:1234")) {
    try {
      const host = baseURL.replace(/\/v1\/?$/, "");
      const res = await fetch(`${host}/api/v1/models`);
      if (res.ok) {
        const data = await res.json() as any;
        if (data && Array.isArray(data.models)) {
          // Filter type === "llm" if they exist, otherwise map all keys
          const llms = data.models.filter((m: any) => m.type === "llm");
          if (llms.length > 0) {
            return llms.map((m: any) => m.key);
          }
          return data.models.map((m: any) => m.key);
        }
      }
    } catch (err) {
      console.warn("Failed to query native LM Studio models endpoint:", err);
    }
  }

  try {
    const list = await openai.models.list();
    return list.data.map((m) => m.id);
  } catch (error) {
    console.warn("Failed to retrieve models from AI server:", error);
    return ["local-model-default"];
  }
}

/**
 * Dynamic query for loaded models from LM Studio / OpenAI (using standard /v1/models)
 */
export async function getLoadedModels(): Promise<string[]> {
  try {
    const list = await openai.models.list();
    return list.data.map((m) => m.id);
  } catch (error) {
    console.warn("Failed to retrieve loaded models from AI server:", error);
    return [];
  }
}

interface RAGContext {
  statsText: string;
  notesContext: string;
}

/**
 * Compiles quantitative statistics and searches qualitative entries to construct a RAG prompt
 */
async function buildRAGContext(accountId: string, userQuery: string): Promise<RAGContext> {
  // 1. Fetch account and trades
  const account = await prisma.account.findUnique({
    where: { account_id: accountId },
  });

  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  const dbTrades = await prisma.trade.findMany({
    where: { account_id: accountId },
    include: { executions: true, trade_tags: { include: { tag: true } }, market_context: true },
  });

  // Calculate quantitative stats
  const metrics = calculateMetrics(dbTrades, Number(account.initial_balance));

  // Build weekday metrics
  const dayStats: { [key: string]: { trades: number; pnl: number } } = {
    Sunday: { trades: 0, pnl: 0 },
    Monday: { trades: 0, pnl: 0 },
    Tuesday: { trades: 0, pnl: 0 },
    Wednesday: { trades: 0, pnl: 0 },
    Thursday: { trades: 0, pnl: 0 },
    Friday: { trades: 0, pnl: 0 },
    Saturday: { trades: 0, pnl: 0 },
  };

  dbTrades.forEach((t) => {
    if (t.status === "CLOSED") {
      const date = new Date(t.created_at);
      const day = date.toLocaleDateString("en-US", { weekday: "long" });
      if (dayStats[day]) {
        dayStats[day].trades++;
        dayStats[day].pnl += Number(t.net_pnl);
      }
    }
  });

  const statsText = `
Trader Account Name: ${account.account_name} (${account.broker_name})
Current Balance: $${(Number(account.initial_balance) + dbTrades.reduce((acc, t) => acc + Number(t.net_pnl), 0)).toFixed(2)}
Total Closed Trades: ${metrics.totalTrades}
Win Rate: ${(metrics.winRate * 100).toFixed(1)}%
Profit Factor: ${metrics.profitFactor.toFixed(2)}
Expectancy (Nominal): $${metrics.expectancyNominal.toFixed(2)}
Expectancy (R-Multiple): +${metrics.expectancyR.toFixed(2)}R
Maximum Drawdown: ${metrics.maxDrawdown.toFixed(2)}%
Zella Score Equivalent: ${metrics.zellaScore}/100
Rule Adherence Rate: ${(metrics.ruleAdherenceRate * 100).toFixed(1)}%
Cost of Indiscipline: $${metrics.costOfIndiscipline.toFixed(2)} (losses on trades where rules were broken)

Performance by Day of Week:
- Monday: ${dayStats["Monday"].trades} trades, Net P&L: $${dayStats["Monday"].pnl.toFixed(2)}
- Tuesday: ${dayStats["Tuesday"].trades} trades, Net P&L: $${dayStats["Tuesday"].pnl.toFixed(2)}
- Wednesday: ${dayStats["Wednesday"].trades} trades, Net P&L: $${dayStats["Wednesday"].pnl.toFixed(2)}
- Thursday: ${dayStats["Thursday"].trades} trades, Net P&L: $${dayStats["Thursday"].pnl.toFixed(2)}
- Friday: ${dayStats["Friday"].trades} trades, Net P&L: $${dayStats["Friday"].pnl.toFixed(2)}
`;

  // 2. Perform semantic search over qualitative notes
  let notesContext = "No matching historical notes found.";
  if (userQuery.trim() !== "") {
    const queryVec = await generateEmbedding(userQuery);
    const tradesWithNotes = dbTrades.filter((t) => t.notes && t.notes.trim() !== "" && t.notes_vector);

    if (tradesWithNotes.length > 0) {
      const scoredTrades = tradesWithNotes.map((t) => {
        let noteVec: number[] = [];
        try {
          noteVec = JSON.parse(t.notes_vector!);
        } catch (e) {
          // If parse fails, return empty
        }
        const similarity = cosineSimilarity(queryVec, noteVec);
        return { trade: t, similarity };
      });

      // Sort by similarity and pick top 4 matches
      scoredTrades.sort((a, b) => b.similarity - a.similarity);
      const topMatches = scoredTrades.slice(0, 4).filter((m) => m.similarity > 0.15);

      if (topMatches.length > 0) {
        notesContext = topMatches
          .map((m, index) => {
            const t = m.trade;
            const tagNames = t.trade_tags.map((tt) => tt.tag.tag_name).join(", ");
            const regime = t.market_context[0]?.regime_type || "Unknown";
            return `--- Match #${index + 1} (Similarity: ${(m.similarity * 100).toFixed(1)}%) ---
Trade ID: ${t.trade_id.slice(0, 8)}
Symbol: ${t.symbol} | P&L: $${Number(t.net_pnl).toFixed(2)} | R-Multiple: ${Number(t.r_multiple).toFixed(2)}R
Date: ${new Date(t.created_at).toLocaleDateString()}
Rules Followed: ${t.rules_followed ? "YES" : "NO"}
Market Regime: ${regime}
Tags: ${tagNames || "None"}
Trader Notes: "${t.notes}"`;
          })
          .join("\n\n");
      }
    }
  }

  return { statsText, notesContext };
}

/**
 * Tool Definition for natural language trade entry
 */
const logTradeTool = {
  type: "function" as const,
  function: {
    name: "log_trade",
    description: "Log a completed or open trade based on the user's natural language input. Call this ONLY when you have enough details to log a trade.",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker symbol, e.g., NQ, ES, AAPL" },
        initial_risk: { type: "number", description: "The initial risk amount in dollars or points. Default to 100 if unspecified." },
        executions: {
          type: "array",
          description: "List of trade executions in chronological order (scaling in/out). Include entry and exit fills.",
          items: {
            type: "object",
            properties: {
              side: { type: "string", enum: ["BUY", "SELL"] },
              quantity: { type: "number" },
              fill_price: { type: "number" }
            },
            required: ["side", "quantity", "fill_price"]
          }
        },
        tags: {
          type: "array",
          description: "Tags for the trade, e.g., 'Breakout', 'Wash', 'Revenge'",
          items: { type: "string" }
        },
        stop_loss: { type: "number", description: "Stop loss price" },
        setup_type: { type: "string", description: "Type of setup, e.g., Breakout, Mean Reversion, Range" },
        bias: { type: "string", enum: ["LONG", "SHORT", "RANGE"], description: "Market bias during the trade" },
        rules_followed: { type: "boolean", description: "Whether the trader followed their rules on this trade. True by default if unmentioned." },
        notes: { type: "string", description: "Any additional qualitative notes about the trade" }
      },
      required: ["symbol", "executions"]
    }
  }
};

async function executeLogTrade(accountId: string, args: any) {
  // 1. Generate embedding for notes
  let embeddingStr: string | null = null;
  if (args.notes && args.notes.trim() !== "") {
    const vec = await generateEmbedding(args.notes);
    embeddingStr = JSON.stringify(vec);
  }

  // Calculate Status based on executions
  let status = "OPEN";
  let totalBuyQty = 0;
  let totalSellQty = 0;
  if (args.executions && Array.isArray(args.executions)) {
    for (const ex of args.executions) {
      if (ex.side === "BUY") totalBuyQty += Number(ex.quantity);
      if (ex.side === "SELL") totalSellQty += Number(ex.quantity);
    }
    if (totalBuyQty > 0 && totalBuyQty === totalSellQty) {
      status = "CLOSED";
    }
  }

  // 2. Create Trade
  const trade = await prisma.trade.create({
    data: {
      symbol: args.symbol.toUpperCase(),
      account_id: accountId,
      status: status,
      manual_status: false,
      rules_followed: args.rules_followed !== undefined ? args.rules_followed : true,
      notes: args.notes || "",
      notes_vector: embeddingStr,
      bias: args.bias || "RANGE",
      trade_type: args.setup_type || "BREAKOUT",
      stop_loss: args.stop_loss ? Number(args.stop_loss) : null,
    },
  });

  // 3. Create executions
  if (args.executions && Array.isArray(args.executions)) {
    for (const ex of args.executions) {
      await prisma.execution.create({
        data: {
          trade_id: trade.trade_id,
          fill_price: Number(ex.fill_price),
          quantity: Number(ex.quantity),
          side: ex.side.toUpperCase(),
          execution_timestamp: new Date(),
        },
      });
    }
    // Recalculate metrics (P&L, duration, r-multiple) after saving executions
    await updateTradeCalculations(trade.trade_id, args.initial_risk ? Number(args.initial_risk) : 100);
  }

  // 4. Handle Tags
  if (args.tags && Array.isArray(args.tags)) {
    for (const tagName of args.tags) {
      const cleanName = tagName.trim();
      if (!cleanName) continue;
      
      // Find or create tag
      let tag = await prisma.tag.findUnique({
        where: { tag_name: cleanName }
      });
      
      if (!tag) {
        tag = await prisma.tag.create({
          data: {
            tag_name: cleanName,
            tag_category: "Setup",
            color_code: "#1f2937", // Default dark gray
          }
        });
      }
      
      // Link tag to trade
      await prisma.tradeTag.create({
        data: {
          trade_id: trade.trade_id,
          tag_id: tag.tag_id
        }
      });
    }
  }
  
  return trade;
}

/**
 * Streams the response from the LLM endpoint for a coach query using SSE
 */
export async function streamAICoach(
  accountId: string,
  userQuery: string,
  reconciliationReportJson: string | null,
  modelName: string | null,
  image: string | null,
  customSystemPrompt: string | null,
  historyLimit: number,
  onToken: (token: string) => void,
  onComplete: (fullText: string) => void
): Promise<void> {
  const { statsText, notesContext } = await buildRAGContext(accountId, userQuery);

  let reconciliationReportText = "No statement reconciliation report provided.";
  if (reconciliationReportJson) {
    try {
      const report = JSON.parse(reconciliationReportJson);
      const summary = report.summary || {};
      
      let matchedText = "";
      if (report.matched && report.matched.length > 0) {
        matchedText = report.matched.map((m: any) => 
          `- Symbol: ${m.manual?.symbol || m.statement?.symbol} | Side: ${m.manual?.side || m.statement?.side} | Qty: ${m.statement?.quantity}\n` +
          `  Manual Price: ${m.manual?.fill_price} vs Statement Price: ${m.statement?.fillPrice}\n` +
          `  Slippage: ${m.slippage > 0 ? '+' : ''}${m.slippage.toFixed(2)} pts`
        ).join("\n");
      } else {
        matchedText = "None";
      }

      let ghostText = "";
      if (report.ghosts && report.ghosts.length > 0) {
        ghostText = report.ghosts.map((g: any) => 
          `- Symbol: ${g.symbol} | Side: ${g.side} | Qty: ${g.quantity} | Price: ${g.fillPrice} | Time: ${g.timestamp ? new Date(g.timestamp).toLocaleTimeString() : 'N/A'}`
        ).join("\n");
      } else {
        ghostText = "None";
      }

      let orphanText = "";
      if (report.orphans && report.orphans.length > 0) {
        orphanText = report.orphans.map((o: any) => 
          `- Symbol: ${o.symbol} | Side: ${o.side} | Qty: ${o.quantity} | Price: ${o.fill_price} | Time: ${o.execution_timestamp ? new Date(o.execution_timestamp).toLocaleTimeString() : 'N/A'}`
        ).join("\n");
      } else {
        orphanText = "None";
      }

      reconciliationReportText = `
Statement Ingestion Summary:
- Total Statement Executions: ${summary.totalStatementExecutions ?? 0}
- Total Manual Executions: ${summary.totalManualExecutions ?? 0}
- Matched Executions: ${summary.matchedCount ?? 0}
- Unjournaled Ghost Executions: ${summary.ghostCount ?? 0}
- Missing Broker Executions (Orphans): ${summary.orphanCount ?? 0}
- Total Slippage: ${summary.totalSlippage ? summary.totalSlippage.toFixed(2) : 0}

Matched Executions Details:
${matchedText}

Unjournaled Ghost Executions (Warning - Not Logged Manually):
${ghostText}

Orphan Manual Executions (Warning - Logged Manually but not on Broker Statement):
${orphanText}
`;
    } catch (e) {
      console.warn("Failed to parse reconciliationReportJson:", e);
      reconciliationReportText = `Error parsing statement reconciliation report JSON: ${reconciliationReportJson}`;
    }
  }

  const loadedModels = await getLoadedModels();
  let selectedModel = modelName || process.env.LLM_MODEL || "";

  // Try to find if selectedModel or a variant of it is in loadedModels
  let matchedModel = loadedModels.find(m => m === selectedModel || m.startsWith(selectedModel + ":") || selectedModel.startsWith(m + ":"));

  if (!matchedModel && loadedModels.length > 0) {
    matchedModel = loadedModels[0];
  }

  if (matchedModel) {
    selectedModel = matchedModel;
  } else if (!selectedModel) {
    selectedModel = "local-model";
  }

  // Fetch existing tags to provide context to LLM
  const existingTags = await prisma.tag.findMany();
  const existingTagsList = existingTags.map(t => t.tag_name).join(", ");

  let systemPrompt = `
You are the "Antigravity Quantitative Trading Coach", an elite AI-driven performance auditor.
Your goal is to help the trader build their statistical edge, eliminate behavioral biases (like loss aversion, FOMO, and revenge trading), and enforce mathematical discipline.

When the user asks you to log trades from a statement or paste, analyze the execution history chronologically. Identify each distinct flat-to-flat sequence (where the net position starts at zero, scales in/out, and returns to zero). Log each distinct trade by making a separate, parallel call to the log_trade tool. Extract executions in chronological order for each trade. If a single execution has multiple contracts or represents a scaling entry/exit, preserve it in the corresponding trade.
Available tags in the database: [${existingTagsList || "None"}]. Use these tags if appropriate, or create new short, descriptive tags if a new concept is introduced (like "Wash", "Runner Stopped").

Structure your analysis with these principles:
1. Ground your observations strictly in the provided mathematical statistics (Win Rate, Profit Factor, Expectancy, and Cost of Indiscipline).
2. Synthesize these numbers with the qualitative journal notes retrieved via semantic search.
3. Highlight the "Cost of Indiscipline" if they are losing money on rule breaches.
4. If a Statement Ingestion/Reconciliation Report is provided, run a comparative audit:
   - Identify discrepancies between their subjective manual logs and objective broker executions (e.g. ghost trades, orphan trades, or negative slippage).
   - Address Ghost Trades: Why did they trade without journaling? Was it FOMO, impulsive, or revenge trading?
   - Address Slippage: Are they executing poor fills, chasing price, or ignoring limits?
   - Address Orphan Trades: Did they log a trade that never filled? Did they manifest a trade or fail to execute?
5. Keep your tone direct, professional, and diagnostic.
6. Provide actionable, mathematical adjustments (e.g., "reduce sizing on Friday mornings by 50%").

Below is the trader's statistics:
==============================
${statsText}
==============================

Here is the daily statement reconciliation report:
==============================
${reconciliationReportText}
==============================

Here are the most semantically relevant historical journal entries related to the trader's query:
==============================
${notesContext}
==============================
`;

  if (customSystemPrompt && customSystemPrompt.trim() !== "") {
    systemPrompt = customSystemPrompt;
  }

  // Fetch chat history from DB
  let chatHistory: any[] = [];
  try {
    const pastChats = await prisma.chatMessage.findMany({
      where: { account_id: accountId },
      orderBy: { created_at: "desc" },
      take: historyLimit,
    });
    // Reverse because we queried descending to get recent, but LLM expects chronological
    chatHistory = pastChats.reverse().map(c => {
      if (c.image_data) {
        return {
          role: c.role as "user" | "assistant",
          content: [
            { type: "text", text: c.content },
            { type: "image_url", image_url: { url: c.image_data } }
          ]
        };
      }
      return {
        role: c.role as "user" | "assistant",
        content: c.content
      };
    });
  } catch (e) {
    console.warn("Could not fetch chat history for context:", e);
  }

  try {
    // We use the OpenAI-compatible streaming client exclusively to guarantee proper tool_calls handling.
    // Fallback to OpenAI compatible streaming client (which natively handles tool_calls well)
    const userMessageContent: any = image 
      ? [
          { type: "text", text: userQuery },
          { type: "image_url", image_url: { url: image } }
        ]
      : userQuery;

    const stream = await openai.chat.completions.create({
      model: selectedModel,
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: userMessageContent },
      ],
      temperature: 0.3,
      stream: true,
      tools: [logTradeTool],
    });

    let fullText = "";
    // Accumulator for parallel tool calls: index -> { name, arguments }
    interface ToolCallAccumulator {
      name?: string;
      arguments: string;
    }
    const toolCallsMap: { [index: number]: ToolCallAccumulator } = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.tool_calls && delta.tool_calls.length > 0) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (idx === undefined) continue;

          if (!toolCallsMap[idx]) {
            toolCallsMap[idx] = { arguments: "" };
          }
          if (tc.function?.name) {
            toolCallsMap[idx].name = tc.function.name;
          }
          if (tc.function?.arguments) {
            toolCallsMap[idx].arguments += tc.function.arguments;
          }
        }
      } else if (delta?.content) {
        const token = delta.content;
        fullText += token;
        onToken(token);
      }
    }

    // Execute all accumulated tool calls in order
    const sortedIndices = Object.keys(toolCallsMap)
      .map(Number)
      .sort((a, b) => a - b);

    for (const idx of sortedIndices) {
      const toolCall = toolCallsMap[idx];
      if (toolCall.name === "log_trade" && toolCall.arguments) {
        try {
          const args = JSON.parse(toolCall.arguments);
          await executeLogTrade(accountId, args);
          const execsFormat = args.executions ? args.executions.map((e: any) => `${e.side} ${e.quantity} @ ${e.fill_price}`).join(", ") : "";
          const tagsFormat = args.tags ? args.tags.join(", ") : "None";
          const rulesMsg = args.rules_followed === false ? "⚠️ Nudge: Rules were broken." : "🏆 Celebrate: Disciplined execution!";
          const msg = `\n\n✅ **Trade successfully logged!**\n- Symbol: ${args.symbol}\n- Executions: ${execsFormat}\n- Tags: ${tagsFormat}\n- ${rulesMsg}`;
          fullText += msg;
          onToken(msg);
        } catch (err: any) {
          const msg = `\n\n❌ **Failed to log trade via tool (Index ${idx}):** ${err.message}`;
          fullText += msg;
          onToken(msg);
        }
      }
    }

    onComplete(fullText);
  } catch (error) {
    console.error("Error streaming chat completions:", error);
    onToken("Error communicating with LM Studio / AI endpoints. Please ensure your LLM server is running or configure a Cloud OpenAI API key in your `.env` file.");
    onComplete("Error communicating with AI endpoint.");
  }
}
