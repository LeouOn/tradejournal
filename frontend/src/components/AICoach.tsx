import { useState, useRef, useEffect } from "react";
import { Send, Brain, Upload, FileText, CheckCircle, RotateCcw, Sparkles } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AICoachProps {
  accountId: string;
  onRefreshTrades: () => void;
}

export default function AICoach({ accountId, onRefreshTrades }: AICoachProps) {
  // Conversational Chat State
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! I am your Antigravity Quantitative Trading Coach. I analyze your trade entries, scaling behavior, qualitative emotional tags, and current Hidden Markov Model market regimes. Ask me anything, or run one of the diagnostics below.",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Ingest Statement State (Phase 2)
  const [ironbeamText, setIronbeamText] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<{ success: boolean; message: string } | null>(null);
  
  const [analysisReport, setAnalysisReport] = useState<any | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ success: boolean; message: string } | null>(null);

  // Model Selection & Persistent Chats
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Fetch available models
  useEffect(() => {
    fetch("http://localhost:5000/api/ai/models")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setModels(data);
        }
      })
      .catch((err) => console.error("Error fetching models:", err));
  }, []);

  // Fetch chat history
  useEffect(() => {
    if (!accountId) return;
    fetch(`http://localhost:5000/api/ai/chats?accountId=${accountId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setMessages([
            {
              role: "assistant",
              content: "Hello! I am your Antigravity Quantitative Trading Coach. I analyze your trade entries, scaling behavior, qualitative emotional tags, and current Hidden Markov Model market regimes. Ask me anything, or run one of the diagnostics below.",
            },
            ...data.map((m: any) => ({ role: m.role, content: m.content })),
          ]);
        } else {
          setMessages([
            {
              role: "assistant",
              content: "Hello! I am your Antigravity Quantitative Trading Coach. I analyze your trade entries, scaling behavior, qualitative emotional tags, and current Hidden Markov Model market regimes. Ask me anything, or run one of the diagnostics below.",
            },
          ]);
        }
      })
      .catch((err) => console.error("Error fetching chats:", err));
  }, [accountId]);

  const handleClearChat = async () => {
    if (!window.confirm("Are you sure you want to clear your chat history?")) return;
    try {
      const res = await fetch(`http://localhost:5000/api/ai/chats?accountId=${accountId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessages([
          {
            role: "assistant",
            content: "Hello! I am your Antigravity Quantitative Trading Coach. I analyze your trade entries, scaling behavior, qualitative emotional tags, and current Hidden Markov Model market regimes. Ask me anything, or run one of the diagnostics below.",
          },
        ]);
      }
    } catch (err) {
      console.error("Error clearing chat logs:", err);
    }
  };

  // Sends query to Express SSE Coach endpoint
  const handleSendMessage = async (queryText: string, reportData: any = null) => {
    if (!queryText.trim() || !accountId) return;

    // Append user message
    const updatedMessages = [...messages, { role: "user" as const, content: queryText }];
    setMessages(updatedMessages);
    setInputMessage("");
    setIsTyping(true);

    // Placeholder for stream response
    setMessages((prev) => [...prev, { role: "assistant" as const, content: "" }]);

    try {
      let url = `http://localhost:5000/api/ai/coach?accountId=${accountId}&query=${encodeURIComponent(queryText)}`;
      if (selectedModel) {
        url += `&model=${encodeURIComponent(selectedModel)}`;
      }
      if (reportData) {
        url += `&reconciliationReport=${encodeURIComponent(JSON.stringify(reportData))}`;
      }
      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.token) {
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const list = [...prev];
            const last = list[list.length - 1];
            if (last && last.role === "assistant") {
              list[list.length - 1] = {
                ...last,
                content: last.content + data.token,
              };
            }
            return list;
          });
        }

        if (data.complete) {
          eventSource.close();
          setIsTyping(false);
        }
      };

      eventSource.onerror = (err) => {
        console.error("SSE Connection Error:", err);
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const list = [...prev];
          const last = list[list.length - 1];
          if (last && last.role === "assistant" && !last.content) {
            list[list.length - 1] = {
              ...last,
              content: "Error connecting to AI Coach endpoint. Please make sure LM Studio is running on http://localhost:1234/v1 or that you have configured an OpenAI API key.",
            };
          }
          return list;
        });
        eventSource.close();
        setIsTyping(false);
      };

    } catch (e: any) {
      console.error(e);
      setIsTyping(false);
    }
  };

  const handleAnalyzeStatement = async () => {
    if (!ironbeamText.trim()) return alert("Please paste statement content first");
    setIsIngesting(true);
    setIngestStatus(null);
    setSyncStatus(null);
    setAnalysisReport(null);

    try {
      const res = await fetch("http://localhost:5000/api/ingest/ironbeam/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: ironbeamText,
          account_id: accountId
        })
      });

      const data = await res.json();
      if (res.ok) {
        setAnalysisReport(data);
        setIngestStatus({ success: true, message: `Successfully analyzed ${data.summary.totalStatementExecutions} statement execution(s).` });
      } else {
        setIngestStatus({ success: false, message: data.error || "Analysis failed" });
      }
    } catch (e) {
      setIngestStatus({ success: false, message: "Server connection failed" });
    } finally {
      setIsIngesting(false);
    }
  };

  const handleSyncStatement = async () => {
    if (!analysisReport || !accountId) return;
    setIsSyncing(true);
    setSyncStatus(null);

    try {
      const res = await fetch("http://localhost:5000/api/ingest/ironbeam/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          initial_risk: 100,
          matched: analysisReport.matched,
          ghosts: analysisReport.ghosts
        })
      });

      const data = await res.json();
      if (res.ok) {
        setSyncStatus({ success: true, message: data.message });
        setAnalysisReport(null);
        setIronbeamText("");
        onRefreshTrades(); // Update dashboard values
      } else {
        setSyncStatus({ success: false, message: data.error || "Sync failed" });
      }
    } catch (e) {
      setSyncStatus({ success: false, message: "Server connection failed" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTriggerBehavioralAudit = () => {
    if (!analysisReport) return;
    const promptText = `Evaluate my trading performance, execution discipline, and discrepancies between my manual notes and this statement.`;
    handleSendMessage(promptText, analysisReport);
  };

  const diagnosticSuggestions = [
    { label: "Performance Snapshot", query: "Give me a full breakdown of my current performance stats, expectancy, and where my edge is strongest." },
    { label: "Rule Adherence Audit", query: "Analyze my rule adherence, identify any violations, and calculate the cost of indiscipline across my trades." },
    { label: "Regime vs. Expectancy", query: "Compare my expectancy across different market regimes. Where am I profitable and where am I bleeding?" },
    { label: "Execution Quality Review", query: "Audit my execution quality: slippage, fill timing, position sizing, and whether my scaling is helping or hurting expectancy." },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "24px", height: "calc(100vh - 180px)" }}>
      
      {/* Left Column: Chat panel */}
      <div className="glass-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Brain style={{ color: "var(--accent-blue)" }} />
            <h3 style={{ fontSize: "1.1rem" }}>AI Diagnostic Coach</h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <select
              className="input-field"
              style={{ padding: "4px 8px", fontSize: "0.8rem", width: "160px", margin: 0, height: "30px", minHeight: "30px" }}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <option value="">Default Model</option>
              {models.map((m) => (
                <option key={m} value={m}>
                  {m.length > 20 ? m.slice(0, 20) + "..." : m}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary"
              style={{ padding: "4px 8px", fontSize: "0.75rem", height: "30px", display: "flex", alignItems: "center", justifyContent: "center" }}
              onClick={handleClearChat}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Message logs */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", paddingRight: "8px", marginBottom: "16px" }}>
          {messages.map((m, index) => (
            <div
              key={index}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                background: m.role === "user" ? "var(--msg-user-bg)" : "var(--msg-assistant-bg)",
                border: `1px solid ${m.role === "user" ? "var(--accent-blue)" : "var(--border-color)"}`,
                borderRadius: "12px",
                padding: "10px 14px",
                fontSize: "0.9rem",
                color: "var(--text-primary)",
                whiteSpace: "pre-line"
              }}
            >
              {m.content}
            </div>
          ))}
          {isTyping && (
            <div style={{ alignSelf: "flex-start", color: "var(--text-secondary)", fontSize: "0.85rem", fontStyle: "italic", marginLeft: "10px" }}>
              Coach is compiling stats and writing report...
            </div>
          )}
          <div ref={chatBottomRef} />
        </div>

        {/* Diagnostic Shortcuts */}
        <div style={{ marginBottom: "14px" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>Quick Diagnostics:</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {diagnosticSuggestions.map((s, idx) => (
              <button
                key={idx}
                className="btn-secondary"
                style={{ padding: "4px 8px", fontSize: "0.75rem", borderRadius: "16px" }}
                onClick={() => handleSendMessage(s.query)}
                disabled={isTyping}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input area */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputMessage);
          }}
          style={{ display: "flex", gap: "10px" }}
        >
          <input
            type="text"
            className="input-field"
            placeholder="Query your trading performance patterns..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isTyping}
          />
          <button type="submit" className="btn-primary" style={{ padding: "10px 16px" }} disabled={isTyping}>
            <Send size={16} />
          </button>
        </form>
      </div>

      {/* Right Column: Statement Ingestion & Reconciliation */}
      <div className="glass-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Upload style={{ color: "var(--accent-gold)" }} />
            <h3 style={{ fontSize: "1.1rem" }}>Ironbeam Reconciliation</h3>
          </div>
          {analysisReport && (
            <button
              onClick={() => {
                setAnalysisReport(null);
                setIngestStatus(null);
                setSyncStatus(null);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "0.8rem",
              }}
            >
              <RotateCcw size={12} />
              Reset
            </button>
          )}
        </div>

        {!analysisReport ? (
          <>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Copy and paste the raw text fills list from your Ironbeam daily statement. The AI router will parse and reconcile it side-by-side with your manual logs to track executions, slippage, and ghost trades.
            </p>

            {/* Paste Area */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", marginBottom: "16px" }}>
              <textarea
                placeholder="Paste your daily fills list here...&#13;Example:&#13;BUY 2 ES M6 5120.00 05/22 10:24:12&#13;SELL 2 ES M6 5135.25 05/22 10:55:00"
                className="input-field"
                style={{ flex: 1, resize: "none", fontSize: "0.85rem", fontFamily: "monospace" }}
                value={ironbeamText}
                onChange={(e) => setIronbeamText(e.target.value)}
              />
            </div>

            {/* Error Status Report if parsing fails */}
            {ingestStatus && !ingestStatus.success && (
              <div
                className="glass-panel"
                style={{
                  padding: "10px 14px",
                  marginBottom: "16px",
                  backgroundColor: "var(--red-bg)",
                  borderColor: "var(--red-border)",
                  borderWidth: "1px",
                  borderStyle: "solid"
                }}
              >
                <span style={{ fontSize: "0.85rem", color: "var(--accent-red)", fontWeight: "bold", display: "block" }}>
                  Analysis Failed
                </span>
                <p style={{ fontSize: "0.8rem", color: "var(--text-primary)", marginTop: "4px" }}>
                  {ingestStatus.message}
                </p>
              </div>
            )}

            {syncStatus && (
              <div
                className="glass-panel"
                style={{
                  padding: "10px 14px",
                  marginBottom: "16px",
                  backgroundColor: syncStatus.success ? "var(--green-bg)" : "var(--red-bg)",
                  borderColor: syncStatus.success ? "var(--green-border)" : "var(--red-border)",
                  borderWidth: "1px",
                  borderStyle: "solid"
                }}
              >
                <span style={{ fontSize: "0.85rem", color: syncStatus.success ? "var(--accent-green)" : "var(--accent-red)", fontWeight: "bold", display: "block" }}>
                  {syncStatus.success ? "Reconciliation Synced" : "Sync Failed"}
                </span>
                <p style={{ fontSize: "0.8rem", color: "var(--text-primary)", marginTop: "4px" }}>
                  {syncStatus.message}
                </p>
              </div>
            )}

            <button
              className="btn-primary"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
              onClick={handleAnalyzeStatement}
              disabled={isIngesting || !ironbeamText.trim()}
            >
              <FileText size={18} />
              {isIngesting ? "Parsing Fills..." : "Analyze Statement"}
            </button>
          </>
        ) : (
          <>
            {/* Summary statistics boxes */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "16px" }}>
              <div style={{ padding: "10px", background: "rgba(13, 22, 36, 0.4)", borderRadius: "8px", border: "1px solid var(--border-color)", textAlign: "center" }}>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--accent-green)" }}>{analysisReport.summary.matchedCount}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Matched</div>
              </div>
              <div style={{ padding: "10px", background: "rgba(13, 22, 36, 0.4)", borderRadius: "8px", border: "1px solid var(--border-color)", textAlign: "center" }}>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--accent-gold)" }}>{analysisReport.summary.ghostCount}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Ghosts</div>
              </div>
              <div style={{ padding: "10px", background: "rgba(13, 22, 36, 0.4)", borderRadius: "8px", border: "1px solid var(--border-color)", textAlign: "center" }}>
                <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--accent-red)" }}>{analysisReport.summary.orphanCount}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>Orphans</div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--accent-bg)", border: "1px solid var(--border-hover)", borderRadius: "8px", marginBottom: "16px" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-primary)" }}>Net Execution Slippage:</span>
              <span style={{ fontSize: "1rem", fontWeight: "bold", color: analysisReport.summary.totalSlippage >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                {analysisReport.summary.totalSlippage > 0 ? "+" : ""}{analysisReport.summary.totalSlippage.toFixed(2)} pts
              </span>
            </div>

            {/* Reconciliation Report list table */}
            <div style={{ flex: 1, overflowY: "auto", marginBottom: "16px", border: "1px solid var(--border-color)", borderRadius: "8px", background: "rgba(13, 22, 36, 0.2)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-color)", background: "rgba(13, 22, 36, 0.6)" }}>
                    <th style={{ padding: "10px", textAlign: "left", color: "var(--text-secondary)" }}>Type</th>
                    <th style={{ padding: "10px", textAlign: "left", color: "var(--text-secondary)" }}>Trade</th>
                    <th style={{ padding: "10px", textAlign: "right", color: "var(--text-secondary)" }}>Prices</th>
                    <th style={{ padding: "10px", textAlign: "right", color: "var(--text-secondary)" }}>Slippage</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Matched */}
                  {analysisReport.matched.map((m: any, idx: number) => (
                    <tr key={`matched-${idx}`} style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <td style={{ padding: "10px" }}>
                        <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "bold", background: "var(--green-bg-strong)", color: "var(--accent-green)", border: "1px solid var(--green-border)" }}>
                          Matched
                        </span>
                      </td>
                      <td style={{ padding: "10px" }}>
                        <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>{m.manual.symbol}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{m.manual.side} • {m.statement.quantity} lot</div>
                      </td>
                      <td style={{ padding: "10px", textAlign: "right" }}>
                        <div>Stmt: {m.statement.fillPrice.toFixed(2)}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Manual: {m.manual.fill_price.toFixed(2)}</div>
                      </td>
                      <td style={{ padding: "10px", textAlign: "right", color: m.slippage >= 0 ? "var(--accent-green)" : "var(--accent-red)", fontWeight: "600" }}>
                        {m.slippage > 0 ? "+" : ""}{m.slippage.toFixed(2)}
                      </td>
                    </tr>
                  ))}

                  {/* Ghosts */}
                  {analysisReport.ghosts.map((g: any, idx: number) => (
                    <tr key={`ghost-${idx}`} style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <td style={{ padding: "10px" }}>
                        <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "bold", background: "var(--gold-bg)", color: "var(--accent-gold)", border: "1px solid rgba(255, 183, 0, 0.2)" }}>
                          Ghost
                        </span>
                      </td>
                      <td style={{ padding: "10px" }}>
                        <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>{g.symbol}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{g.side} • {g.quantity} lot</div>
                      </td>
                      <td style={{ padding: "10px", textAlign: "right" }}>
                        <div>Stmt: {g.fillPrice.toFixed(2)}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Unjournaled</div>
                      </td>
                      <td style={{ padding: "10px", textAlign: "right", color: "var(--text-secondary)" }}>
                        —
                      </td>
                    </tr>
                  ))}

                  {/* Orphans */}
                  {analysisReport.orphans.map((o: any, idx: number) => (
                    <tr key={`orphan-${idx}`} style={{ borderBottom: "1px solid var(--border-color)" }}>
                      <td style={{ padding: "10px" }}>
                        <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "bold", background: "var(--red-bg-strong)", color: "var(--accent-red)", border: "1px solid var(--red-border)" }}>
                          Orphan
                        </span>
                      </td>
                      <td style={{ padding: "10px" }}>
                        <div style={{ fontWeight: "600", color: "var(--text-primary)" }}>{o.symbol}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{o.side} • {o.quantity} lot</div>
                      </td>
                      <td style={{ padding: "10px", textAlign: "right" }}>
                        <div>Manual: {o.fill_price.toFixed(2)}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Missing fill</div>
                      </td>
                      <td style={{ padding: "10px", textAlign: "right", color: "var(--text-secondary)" }}>
                        —
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <button
                  className="btn-secondary"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "0.85rem", padding: "10px" }}
                  onClick={handleSyncStatement}
                  disabled={isSyncing}
                >
                  <CheckCircle size={16} />
                  {isSyncing ? "Syncing..." : "Sync & Enrich"}
                </button>

                <button
                  className="btn-primary"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "0.85rem", padding: "10px" }}
                  onClick={handleTriggerBehavioralAudit}
                  disabled={isTyping}
                >
                  <Sparkles size={16} />
                  AI Behavior Audit
                </button>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
}
