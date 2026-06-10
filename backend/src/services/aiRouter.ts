import { OpenAI } from "openai";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { calculateMetrics } from "../utils/metrics";
import { updateTradeCalculations } from "../server";
import { applyLIFOMatching } from "../utils/matchingEngines";

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

  // Calculate quantitative stats (FIFO default)
  const metrics = calculateMetrics(dbTrades, Number(account.initial_balance));

  // Calculate LIFO stats
  const allExecutions = dbTrades.flatMap(t => t.executions).sort((a, b) => a.execution_timestamp.getTime() - b.execution_timestamp.getTime());
  const lifoTrades = applyLIFOMatching(allExecutions, accountId);
  const lifoMetrics = calculateMetrics(lifoTrades as any, Number(account.initial_balance));

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

--- LIFO MICRO-SCALP ENGINE (Alternative View) ---
Total Closed Scalps: ${lifoMetrics.totalTrades}
Win Rate: ${(lifoMetrics.winRate * 100).toFixed(1)}%
Profit Factor: ${lifoMetrics.profitFactor.toFixed(2)}
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

const renderUiTool = {
  type: "function" as const,
  function: {
    name: "render_ui",
    description: "Renders an interactive UI component in the chat. Use this when the user asks to see their dashboard, charts, calendar, or specific stats.",
    parameters: {
      type: "object",
      properties: {
        component: { 
          type: "string", 
          enum: ["Dashboard", "PerformanceCharts", "Calendar", "Playbooks", "DrawdownChart", "TimeOfDayChart"],
          description: "The UI component to render" 
        }
      },
      required: ["component"]
    }
  }
};

const recordObservationTool = {
  type: "function" as const,
  function: {
    name: "record_observation",
    description: "Permanently record a qualitative, quantitative, or rule-violation observation to your database so you don't forget it. Use this when you identify a leak or behavior.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["QUALITATIVE", "QUANTITATIVE", "RULE_VIOLATION"] },
        content: { type: "string", description: "The insight or observation" },
        severity: { type: "number", description: "Severity 1-5" },
        related_trade_id: { type: "string", description: "Optional trade UUID if it applies to a specific trade" }
      },
      required: ["type", "content", "severity"]
    }
  }
};

const tagTradeTool = {
  type: "function" as const,
  function: {
    name: "tag_trade",
    description: "Add tags to a specific historical trade.",
    parameters: {
      type: "object",
      properties: {
        trade_id: { type: "string" },
        new_tags: { type: "array", items: { type: "string" } }
      },
      required: ["trade_id", "new_tags"]
    }
  }
};

const toggleLensTool = {
  type: "function" as const,
  function: {
    name: "toggle_lens",
    description: "Toggles the user's UI between the Net Session (FIFO) view and the Execution Edge (LIFO) view. Use this when the user asks to switch views.",
    parameters: {
      type: "object",
      properties: {
        engine: { type: "string", enum: ["FIFO", "LIFO"], description: "The matching engine to use" }
      },
      required: ["engine"]
    }
  }
};

export async function executeLogTrade(accountId: string, args: any) {
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
 * Context flags that control which sections are included in the system prompt.
 */
export interface ContextFlags {
  recentTrades: boolean;
  performanceStats: boolean;
  playbookRules: boolean;
}

/**
 * Fetches playbook rules for the given account's user.
 * Returns empty string if no playbooks exist.
 */
export async function fetchPlaybookRules(accountId: string): Promise<string> {
  try {
    const account = await prisma.account.findUnique({
      where: { account_id: accountId },
    });
    if (!account) return "";

    const user = await prisma.user.findFirst({
      where: { accounts: { some: { account_id: accountId } } },
    });
    if (!user) return "";

    const playbooks = await prisma.playbook.findMany({
      where: { user_id: user.user_id },
    });

    if (playbooks.length === 0) return "";

    return playbooks
      .map(
        (pb, i) =>
          `--- Playbook #${i + 1}: ${pb.setup_name} ---\nDescription: ${pb.description}\nRules: ${pb.ruleset_json}`
      )
      .join("\n\n");
  } catch (e) {
    console.warn("Failed to fetch playbook rules:", e);
    return "";
  }
}

/**
 * Fetches the last N trades for context injection.
 * Returns empty string if no trades exist.
 */
async function fetchRecentTrades(accountId: string, limit = 5): Promise<string> {
  try {
    const trades = await prisma.trade.findMany({
      where: { account_id: accountId, status: "CLOSED" },
      orderBy: { created_at: "desc" },
      take: limit,
      include: { executions: true, trade_tags: { include: { tag: true } } },
    });

    if (trades.length === 0) return "";

    return trades
      .map((t, i) => {
        const side = t.executions.length > 0 ? t.executions[0].side : "N/A";
        return `--- Recent Trade #${i + 1} ---\n` +
          `Symbol: ${t.symbol} | P&L: $${Number(t.net_pnl).toFixed(2)} | R-Multiple: ${Number(t.r_multiple).toFixed(2)}R\n` +
          `Side: ${side} | Status: ${t.status} | Rules Followed: ${t.rules_followed ? "Yes" : "No"}\n` +
          `Tags: ${t.trade_tags.map((tt) => tt.tag.tag_name).join(", ") || "None"}\n` +
          `Notes: ${t.notes || "None"}`;
      })
      .join("\n\n");
  } catch (e) {
    console.warn("Failed to fetch recent trades:", e);
    return "";
  }
}

/**
 * Builds the context sections string for the system prompt based on flags.
 * Exported for testing.
 */
export function buildContextSections(
  statsText: string,
  notesContext: string,
  recentTradesContent: string,
  playbookRulesContent: string,
  flags: ContextFlags
): string {
  let sections = "";

  // Performance Stats (always included by default — now toggleable)
  if (flags.performanceStats) {
    sections += `
Below is the trader's statistics:
==============================
${statsText}
==============================
`;
  }

  // Journal notes context (always included — not toggleable)
  sections += `
Here are the most semantically relevant historical journal entries related to the trader's query:
==============================
${notesContext}
==============================
`;

  // Recent Trades
  if (flags.recentTrades && recentTradesContent) {
    sections += `
Here are the trader's recent trades for context:
==============================
Recent Trades Context:
${recentTradesContent}
==============================
`;
  }

  // Playbook Rules
  if (flags.playbookRules && playbookRulesContent) {
    sections += `
Here are the trader's playbook rules and edge guidelines:
==============================
Playbook Rules:
${playbookRulesContent}
==============================
`;
  }

  return sections;
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
  contextFlags: ContextFlags | null,
  onToken: (token: string) => void,
  onComplete: (fullText: string) => void
): Promise<void> {
  const { statsText, notesContext } = await buildRAGContext(accountId, userQuery);
  const flags: ContextFlags = contextFlags || { recentTrades: true, performanceStats: true, playbookRules: true };

  const recentTradesContent = flags.recentTrades ? await fetchRecentTrades(accountId) : "";
  const playbookRulesContent = flags.playbookRules ? await fetchPlaybookRules(accountId) : "";

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

  const contextSections = buildContextSections(
    statsText,
    notesContext,
    recentTradesContent,
    playbookRulesContent,
    flags
  );

  let systemPrompt = `
You are the "Antigravity Quantitative Trading Coach", an elite AI-driven performance auditor.
Your goal is to help the trader build their statistical edge, eliminate behavioral biases (like loss aversion, FOMO, and revenge trading), and enforce mathematical discipline.

When the user asks you to log trades from a statement or paste, analyze the execution history chronologically. Identify each distinct flat-to-flat sequence (where the net position starts at zero, scales in/out, and returns to zero). Log each distinct trade by making a separate, parallel call to the log_trade tool. Extract executions in chronological order for each trade. If a single execution has multiple contracts or represents a scaling entry/exit, preserve it in the corresponding trade.

Available tags in the database: [${existingTagsList || "None"}]. Use these tags if appropriate, or create new short, descriptive tags if a new concept is introduced (like "Wash", "Runner Stopped").

Structure your analysis with these principles:
1. Ground your observations strictly in the provided mathematical statistics (Win Rate, Profit Factor, Expectancy, and Cost of Indiscipline).
2. Synthesize these numbers with the qualitative journal notes retrieved via semantic search.
3. Highlight the "Cost of Indiscipline" if they are losing money on rule breaches.
4. Keep the Context Clean: If the user pastes a massive list of executions or the chat feels long, strongly recommend that they click the "Compress History" button or ask you to "compress history" so you can summarize the session and maintain lightning-fast response times.
5. If a Statement Ingestion/Reconciliation Report is provided, run a comparative audit:
   - Identify discrepancies between their subjective manual logs and objective broker executions (e.g. ghost trades, orphan trades, or negative slippage).
   - Address Ghost Trades: Why did they trade without journaling? Was it FOMO, impulsive, or revenge trading?
   - Address Slippage: Are they executing poor fills, chasing price, or ignoring limits?
   - Address Orphan Trades: Did they log a trade that never filled? Did they manifest a trade or fail to execute?
6. Keep your tone direct, professional, and diagnostic.
7. Provide actionable, mathematical adjustments (e.g., "reduce sizing on Friday mornings by 50%").

${contextSections}

Here is the daily statement reconciliation report:
==============================
${reconciliationReportText}
==============================
`;

  if (customSystemPrompt && customSystemPrompt.trim() !== "") {
    systemPrompt = customSystemPrompt;
  }

  // Fetch chat history from DB
  let chatHistory: any[] = [];
  try {
    // Always fetch all active summaries
    const summaries = await prisma.chatMessage.findMany({
      where: { account_id: accountId, is_summary: true },
      orderBy: { created_at: "asc" }
    });
    
    // Fetch recent unarchived normal chats
    const pastChats = await prisma.chatMessage.findMany({
      where: { account_id: accountId, is_archived: false, is_summary: false },
      orderBy: { created_at: "desc" },
      take: historyLimit,
    });
    
    const combinedChats = [...summaries, ...pastChats.reverse()].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

    chatHistory = combinedChats.map(c => {
      let contentText = c.content;
      // Truncate large raw trade statements in history for performance optimization, but preserve summaries
      if (!c.is_summary && contentText.length > 300 && (contentText.includes("MNQ") || contentText.includes("BOUGHT") || contentText.includes("SOLD") || contentText.includes("BOT") || contentText.includes("SLD"))) {
        contentText = "[Large statement/execution data omitted to preserve context speed. The trades were already logged.]";
      }

      if (c.image_data) {
        return {
          role: c.role as "user" | "assistant",
          content: [
            { type: "text", text: contentText },
            { type: "image_url", image_url: { url: c.image_data } }
          ]
        };
      }
      return {
        role: c.role as "user" | "assistant",
        content: contentText
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
      tools: [logTradeTool, renderUiTool, recordObservationTool, tagTradeTool, toggleLensTool],
      max_tokens: 8192,
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
        process.stdout.write("."); // Add progress dot for tool calls
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
      if (!toolCall.arguments) continue;
      
      try {
        const args = JSON.parse(toolCall.arguments);

        switch (toolCall.name) {
          case "log_trade":
            await executeLogTrade(accountId, args);
            const execsFormat = args.executions ? args.executions.map((e: any) => `${e.side} ${e.quantity} @ ${e.fill_price}`).join(", ") : "";
            const tagsFormat = args.tags ? args.tags.join(", ") : "None";
            const rulesMsg = args.rules_followed === false ? "⚠️ Nudge: Rules were broken." : "🎉 Celebrate: Disciplined execution!";
            const msgTrade = `\n\n📌 **Trade successfully logged!**\n- Symbol: ${args.symbol}\n- Executions: ${execsFormat}\n- Tags: ${tagsFormat}\n- ${rulesMsg}`;
            fullText += msgTrade;
            onToken(msgTrade);
            break;

          case "render_ui":
            const widgetMsg = `\n\n[WIDGET: {"component": "${args.component}"}]\n\n`;
            fullText += widgetMsg;
            onToken(widgetMsg);
            break;

          case "toggle_lens":
            const toggleMsg = `\n\n[LENS_TOGGLE: {"engine": "${args.engine}"}]\n\n`;
            fullText += toggleMsg;
            onToken(toggleMsg);
            break;

          case "record_observation":
            await prisma.coachObservation.create({
              data: {
                account_id: accountId,
                observation_type: args.type,
                content: args.content,
                severity: args.severity,
                related_trade_id: args.related_trade_id || null
              }
            });
            const msgObs = `\n\n📝 **Observation Saved [${args.type} - Severity ${args.severity}]**: ${args.content}`;
            fullText += msgObs;
            onToken(msgObs);
            break;

          case "tag_trade":
            // Fetch trade to ensure it exists
            const trade = await prisma.trade.findUnique({ where: { trade_id: args.trade_id }, include: { trade_tags: true } });
            if (trade && args.new_tags && Array.isArray(args.new_tags)) {
              for (const tagName of args.new_tags) {
                // Find or create tag
                let tag = await prisma.tag.findUnique({ where: { tag_name: tagName } });
                if (!tag) {
                  tag = await prisma.tag.create({
                    data: {
                      tag_category: "AI_GENERATED",
                      tag_name: tagName,
                      color_code: "#4A90E2"
                    }
                  });
                }
                // Link tag to trade
                const existing = trade.trade_tags.find((tt: any) => tt.tag_id === tag!.tag_id);
                if (!existing) {
                  await prisma.tradeTag.create({
                    data: {
                      trade_id: trade.trade_id,
                      tag_id: tag.tag_id
                    }
                  });
                }
              }
              const msgTag = `\n\n🏷️ **Trade Tagged**: ${args.new_tags.join(", ")}`;
              fullText += msgTag;
              onToken(msgTag);
            }
            break;

          default:
            console.warn("Unknown tool call executed:", toolCall.name);
            break;
        }
      } catch (err: any) {
        const msgErr = `\n\n❌ **Failed to execute tool ${toolCall.name} (Index ${idx}):** ${err.message}`;
        fullText += msgErr;
        onToken(msgErr);
      }
    }

    onComplete(fullText);
  } catch (error) {
    console.error("Error streaming chat completions:", error);
    onToken("Error communicating with LM Studio / AI endpoints. Please ensure your LLM server is running or configure a Cloud OpenAI API key in your `.env` file.");
    onComplete("Error communicating with AI endpoint.");
  }
}
