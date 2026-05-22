"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEmbedding = generateEmbedding;
exports.getAvailableModels = getAvailableModels;
exports.streamAICoach = streamAICoach;
const openai_1 = require("openai");
const client_1 = require("@prisma/client");
const dotenv_1 = __importDefault(require("dotenv"));
const metrics_1 = require("../utils/metrics");
dotenv_1.default.config();
const prisma = new client_1.PrismaClient();
// Initialize OpenAI client pointing to either LM Studio (localhost:1234) or OpenAI Cloud
const baseURL = process.env.OPENAI_BASE_URL || "http://localhost:1234/v1";
const apiKey = process.env.OPENAI_API_KEY || "lm-studio";
const openai = new openai_1.OpenAI({
    baseURL,
    apiKey,
    dangerouslyAllowBrowser: false, // Node context
});
/**
 * Computes cosine similarity between two vector arrays
 */
function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
/**
 * Generates vector embeddings for a given string.
 * Falls back to a deterministic pseudo-vector if the API is unavailable
 * to ensure the app continues to function smoothly without LLM server running.
 */
async function generateEmbedding(text) {
    if (!text || text.trim() === "") {
        return new Array(384).fill(0);
    }
    try {
        const response = await openai.embeddings.create({
            model: process.env.LLM_MODEL || "text-embedding-3-small", // or whatever is loaded locally
            input: text,
        });
        return response.data[0].embedding;
    }
    catch (error) {
        console.warn("Failed to generate embedding via LLM API, using deterministic hash fallback:", error);
        // Generate a simple, deterministic pseudo-vector of 384 dimensions
        const vec = [];
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
async function getAvailableModels() {
    // If we are pointing to LM Studio port 1234, try the native LM Studio v1 endpoint first
    if (baseURL.includes("localhost:1234") || baseURL.includes("127.0.0.1:1234")) {
        try {
            const host = baseURL.replace(/\/v1\/?$/, "");
            const res = await fetch(`${host}/api/v1/models`);
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data.models)) {
                    // Filter type === "llm" if they exist, otherwise map all keys
                    const llms = data.models.filter((m) => m.type === "llm");
                    if (llms.length > 0) {
                        return llms.map((m) => m.key);
                    }
                    return data.models.map((m) => m.key);
                }
            }
        }
        catch (err) {
            console.warn("Failed to query native LM Studio models endpoint:", err);
        }
    }
    try {
        const list = await openai.models.list();
        return list.data.map((m) => m.id);
    }
    catch (error) {
        console.warn("Failed to retrieve models from AI server:", error);
        return ["local-model-default"];
    }
}
/**
 * Compiles quantitative statistics and searches qualitative entries to construct a RAG prompt
 */
async function buildRAGContext(accountId, userQuery) {
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
    const metrics = (0, metrics_1.calculateMetrics)(dbTrades, Number(account.initial_balance));
    // Build weekday metrics
    const dayStats = {
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
                let noteVec = [];
                try {
                    noteVec = JSON.parse(t.notes_vector);
                }
                catch (e) {
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
 * Streams the response from the LLM endpoint for a coach query using SSE
 */
async function streamAICoach(accountId, userQuery, reconciliationReportJson, onToken, onComplete) {
    const { statsText, notesContext } = await buildRAGContext(accountId, userQuery);
    let reconciliationReportText = "No statement reconciliation report provided.";
    if (reconciliationReportJson) {
        try {
            const report = JSON.parse(reconciliationReportJson);
            const summary = report.summary || {};
            let matchedText = "";
            if (report.matched && report.matched.length > 0) {
                matchedText = report.matched.map((m) => `- Symbol: ${m.manual?.symbol || m.statement?.symbol} | Side: ${m.manual?.side || m.statement?.side} | Qty: ${m.statement?.quantity}\n` +
                    `  Manual Price: ${m.manual?.fill_price} vs Statement Price: ${m.statement?.fillPrice}\n` +
                    `  Slippage: ${m.slippage > 0 ? '+' : ''}${m.slippage.toFixed(2)} pts`).join("\n");
            }
            else {
                matchedText = "None";
            }
            let ghostText = "";
            if (report.ghosts && report.ghosts.length > 0) {
                ghostText = report.ghosts.map((g) => `- Symbol: ${g.symbol} | Side: ${g.side} | Qty: ${g.quantity} | Price: ${g.fillPrice} | Time: ${g.timestamp ? new Date(g.timestamp).toLocaleTimeString() : 'N/A'}`).join("\n");
            }
            else {
                ghostText = "None";
            }
            let orphanText = "";
            if (report.orphans && report.orphans.length > 0) {
                orphanText = report.orphans.map((o) => `- Symbol: ${o.symbol} | Side: ${o.side} | Qty: ${o.quantity} | Price: ${o.fill_price} | Time: ${o.execution_timestamp ? new Date(o.execution_timestamp).toLocaleTimeString() : 'N/A'}`).join("\n");
            }
            else {
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
        }
        catch (e) {
            console.warn("Failed to parse reconciliationReportJson:", e);
            reconciliationReportText = `Error parsing statement reconciliation report JSON: ${reconciliationReportJson}`;
        }
    }
    const models = await getAvailableModels();
    const selectedModel = process.env.LLM_MODEL || models[0] || "local-model";
    const systemPrompt = `
You are the "Antigravity Quantitative Trading Coach", an elite AI-driven performance auditor.
Your goal is to help the trader build their statistical edge, eliminate behavioral biases (like loss aversion, FOMO, and revenge trading), and enforce mathematical discipline.

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
    try {
        // If using local host, try the native LM Studio v1 endpoint first
        if (baseURL.includes("localhost:1234") || baseURL.includes("127.0.0.1:1234")) {
            try {
                const host = baseURL.replace(/\/v1\/?$/, "");
                const response = await fetch(`${host}/api/v1/chat`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(apiKey && apiKey !== "lm-studio" ? { "Authorization": `Bearer ${apiKey}` } : {}),
                    },
                    body: JSON.stringify({
                        model: selectedModel,
                        input: userQuery,
                        system_prompt: systemPrompt,
                        stream: true,
                    }),
                });
                if (response.ok && response.body) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    let fullText = "";
                    let currentEvent = "";
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop() || "";
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed.startsWith("event:")) {
                                currentEvent = trimmed.slice(6).trim();
                            }
                            else if (trimmed.startsWith("data:")) {
                                const dataStr = trimmed.slice(5).trim();
                                if (dataStr) {
                                    try {
                                        const parsed = JSON.parse(dataStr);
                                        if ((currentEvent === "message.delta" || parsed.type === "message.delta") && parsed.content) {
                                            fullText += parsed.content;
                                            onToken(parsed.content);
                                        }
                                        else if ((currentEvent === "error" || parsed.type === "error") && parsed.message) {
                                            onToken(`[Error: ${parsed.message}]`);
                                        }
                                    }
                                    catch (e) {
                                        // Ignore parsing errors for incomplete chunks
                                    }
                                }
                            }
                        }
                    }
                    onComplete(fullText);
                    return; // Success, exit
                }
                else {
                    console.warn(`Native LM Studio API returned status ${response.status}. Falling back to OpenAI compatible API.`);
                }
            }
            catch (nativeError) {
                console.warn("Native LM Studio call failed, falling back to OpenAI compatible API:", nativeError);
            }
        }
        // Fallback to OpenAI compatible streaming client
        const stream = await openai.chat.completions.create({
            model: selectedModel,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userQuery },
            ],
            temperature: 0.3,
            stream: true,
        });
        let fullText = "";
        for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content || "";
            if (token) {
                fullText += token;
                onToken(token);
            }
        }
        onComplete(fullText);
    }
    catch (error) {
        console.error("Error streaming chat completions:", error);
        onToken("Error communicating with LM Studio / AI endpoints. Please ensure your LLM server is running or configure a Cloud OpenAI API key in your `.env` file.");
        onComplete("Error communicating with AI endpoint.");
    }
}
