import React, { useState, useEffect, useCallback } from "react";
import { 
  Plus, Brain, Trophy, ChevronRight, FileText, BarChart3, HelpCircle 
} from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  Legend, ResponsiveContainer, ReferenceLine 
} from "recharts";
import { useToast } from "../contexts/ToastContext";
import type { Trade } from "./Dashboard";

interface Playbook {
  playbook_id: string;
  setup_name: string;
  description: string;
  ruleset_json: string;
  created_at?: string;
}

interface WeeklyReport {
  report_id: string;
  start_date: string;
  end_date: string;
  summary_md: string;
  created_at: string;
}

interface PlaybooksProps {
  accountId: string;
  trades: Trade[];
  onRefreshTrades: () => void;
}

export default function Playbooks({ accountId, trades, onRefreshTrades }: PlaybooksProps) {
  const toast = useToast();
  const [activeSubTab, setActiveSubTab] = useState<"analytics" | "audits">("analytics");
  
  // Playbooks states
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [setupName, setSetupName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [isCreatingPlaybook, setIsCreatingPlaybook] = useState(false);
  const [showAddPlaybook, setShowAddPlaybook] = useState(false);

  // Audits states
  const [reports, setReports] = useState<WeeklyReport[]>([]);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [selectedReport, setSelectedReport] = useState<WeeklyReport | null>(null);

  // Fetch Playbooks and Reports
  const fetchPlaybooksAndReports = useCallback(async () => {
    if (!accountId) return;
    try {
      // Playbooks
      const playbooksRes = await fetch("http://localhost:5000/api/playbooks");
      const playbooksData = await playbooksRes.json();
      setPlaybooks(playbooksData);

      // Weekly Reports
      const reportsRes = await fetch(`http://localhost:5000/api/weekly-reports?accountId=${accountId}`);
      const reportsData = await reportsRes.json();
      setReports(reportsData);
    } catch (e) {
      console.error("Failed to load playbooks/reports data:", e);
    }
  }, [accountId]);

  useEffect(() => {
    const load = async () => {
      await fetchPlaybooksAndReports();
    };
    load();
  }, [fetchPlaybooksAndReports]);

  // Handle Playbook Submission
  const handleCreatePlaybook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupName.trim()) {
      toast.error("Setup name is required.");
      return;
    }
    
    setIsCreatingPlaybook(true);
    try {
      const res = await fetch("http://localhost:5000/api/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setup_name: setupName,
          description: description,
          ruleset_json: { rules: rules.split("\n").filter(r => r.trim() !== "") }
        }),
      });
      
      if (res.ok) {
        toast.success("New playbook entry registered! 📚");
        setSetupName("");
        setDescription("");
        setRules("");
        setShowAddPlaybook(false);
        fetchPlaybooksAndReports();
        onRefreshTrades();
      } else {
        toast.error("Failed to save playbook.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Network error saving playbook.");
    } finally {
      setIsCreatingPlaybook(false);
    }
  };

  // Generate Weekly Performance Audit
  const handleGenerateAudit = async () => {
    if (!accountId) return;
    
    setIsGeneratingReport(true);
    toast.info("AI Quant Coach is auditing your trades. This takes about 10-15 seconds...", "Running Weekly Performance Audit", 8000);
    
    try {
      // Generate for the last 7 days by default
      const res = await fetch("http://localhost:5000/api/weekly-reports/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString()
        })
      });

      if (res.ok) {
        const newReport = await res.json();
        setReports(prev => [newReport, ...prev]);
        setSelectedReport(newReport);
        setActiveSubTab("audits");
        toast.success("AI weekly performance audit generated successfully! Review below. 🏆");
        fetchPlaybooksAndReports();
        onRefreshTrades();
      } else {
        toast.error("AI was unable to generate audit. Ensure your LM Studio is running and model is loaded.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Network error triggering weekly audit.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // ----------------------------------------------------
  // CALCULATE SETUP EXPECTANCY PER REGIME
  // ----------------------------------------------------
  const calculateRegimeExpectancyData = () => {
    // Gather all setup tags from closed trades
    const setupStats: Record<string, { lowVolPNL: number[]; lowVolCount: number; highVolPNL: number[]; highVolCount: number }> = {};
    
    trades.forEach((t) => {
      if (t.status !== "CLOSED") return;
      const rMult = Number(t.r_multiple) || 0;
      
      // Determine regime (Low Vol vs High Vol)
      const context = t.market_context && t.market_context[0];
      const isHighVol = context?.regime_type?.toLowerCase().includes("high volatility") || Number(context?.vix_level) >= 20;

      // Extract Setup tags
      const setupTags = t.trade_tags
        .filter(tt => tt.tag.tag_category === "Setup")
        .map(tt => tt.tag.tag_name);

      // Fallback to trade_type if no setup tags are set
      if (setupTags.length === 0 && t.trade_type) {
        setupTags.push(t.trade_type);
      }

      setupTags.forEach((tagName) => {
        if (!setupStats[tagName]) {
          setupStats[tagName] = { lowVolPNL: [], lowVolCount: 0, highVolPNL: [], highVolCount: 0 };
        }
        if (isHighVol) {
          setupStats[tagName].highVolPNL.push(rMult);
          setupStats[tagName].highVolCount++;
        } else {
          setupStats[tagName].lowVolPNL.push(rMult);
          setupStats[tagName].lowVolCount++;
        }
      });
    });

    // Compile into Recharts format
    const chartData = Object.keys(setupStats).map((tag) => {
      const stats = setupStats[tag];
      const lowVolAvg = stats.lowVolCount > 0 ? stats.lowVolPNL.reduce((a,b) => a+b, 0) / stats.lowVolCount : 0;
      const highVolAvg = stats.highVolCount > 0 ? stats.highVolPNL.reduce((a,b) => a+b, 0) / stats.highVolCount : 0;
      return {
        name: tag,
        "Low Volatility (R)": parseFloat(lowVolAvg.toFixed(2)),
        "High Volatility (R)": parseFloat(highVolAvg.toFixed(2)),
        lowCount: stats.lowVolCount,
        highCount: stats.highVolCount,
      };
    });

    return chartData.filter(d => d.lowCount > 0 || d.highCount > 0);
  };

  const chartData = calculateRegimeExpectancyData();

  // Helper to parse rules JSON
  const getRulesList = (rulesetJson: string): string[] => {
    try {
      const parsed = JSON.parse(rulesetJson);
      return parsed.rules || [];
    } catch {
      return [];
    }
  };

  // Helper to format markdown in audit reports
  function renderMarkdown(md: string) {
    if (!md) return null;
    const lines = md.split("\n");
    return lines.map((line, idx) => {
      const text = line.trim();
      if (text.startsWith("### ")) {
        return <h4 key={idx} style={{ color: "var(--accent-blue)", fontSize: "1rem", marginTop: "16px", marginBottom: "8px", fontWeight: 600 }}>{text.slice(4)}</h4>;
      }
      if (text.startsWith("## ")) {
        return <h3 key={idx} style={{ color: "var(--accent-blue)", fontSize: "1.15rem", marginTop: "20px", marginBottom: "10px", fontWeight: 700, borderBottom: "1px solid var(--border-color)", paddingBottom: "4px" }}>{text.slice(3)}</h3>;
      }
      if (text.startsWith("# ")) {
        return <h2 key={idx} style={{ color: "var(--text-primary)", fontSize: "1.3rem", marginTop: "24px", marginBottom: "12px", fontWeight: 800 }} className="title-gradient">{text.slice(2)}</h2>;
      }
      if (text.startsWith("- ") || text.startsWith("* ")) {
        return <li key={idx} style={{ marginLeft: "20px", fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "4px", listStyleType: "square" }}>{text.slice(2)}</li>;
      }
      if (text.match(/^\d+\.\s/)) {
        const dotIndex = text.indexOf(".");
        return <div key={idx} style={{ marginLeft: "10px", fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "6px" }}><strong style={{ color: "var(--text-primary)" }}>{text.substring(0, dotIndex + 1)}</strong> {text.substring(dotIndex + 1).trim()}</div>;
      }
      if (text === "") {
        return <div key={idx} style={{ height: "10px" }} />;
      }
      
      const parts = line.split(/(\*\*.*?\*\*)/g);
      const content = parts.map((part, pIdx) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={pIdx} style={{ color: "var(--text-primary)" }}>{part.slice(2, -2)}</strong>;
        }
        return part;
      });

      return <p key={idx} style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "8px", lineHeight: 1.6 }}>{content}</p>;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Sub tabs header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px" }}>
        <div style={{ display: "flex", gap: "16px" }}>
          <button 
            className="btn-secondary" 
            onClick={() => setActiveSubTab("analytics")}
            style={{ 
              border: "none", 
              background: activeSubTab === "analytics" ? "var(--accent-bg)" : "transparent",
              color: activeSubTab === "analytics" ? "var(--accent-blue)" : "var(--text-secondary)",
              fontWeight: 600,
              padding: "8px 16px"
            }}
          >
            <BarChart3 size={16} style={{ marginRight: "6px", display: "inline" }} />
            Setup Analytics & Playbooks
          </button>
          <button 
            className="btn-secondary" 
            onClick={() => setActiveSubTab("audits")}
            style={{ 
              border: "none", 
              background: activeSubTab === "audits" ? "var(--accent-bg)" : "transparent",
              color: activeSubTab === "audits" ? "var(--accent-blue)" : "var(--text-secondary)",
              fontWeight: 600,
              padding: "8px 16px"
            }}
          >
            <Brain size={16} style={{ marginRight: "6px", display: "inline" }} />
            AI Weekly Audits
          </button>
        </div>

        {activeSubTab === "analytics" && (
          <button className="btn-primary" onClick={() => setShowAddPlaybook(!showAddPlaybook)} style={{ fontSize: "0.8rem", padding: "8px 16px", display: "flex", alignItems: "center", gap: "6px" }}>
            <Plus size={14} />
            Create Setup Playbook
          </button>
        )}
      </div>

      {/* ----------------------------------------------------
          SUB-TAB 1: SETUP ANALYTICS & PLAYBOOKS
          ---------------------------------------------------- */}
      {activeSubTab === "analytics" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
          
          {/* Playbook creation form */}
          {showAddPlaybook && (
            <form onSubmit={handleCreatePlaybook} className="glass-panel glow-effect" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <h3 style={{ fontSize: "1rem", color: "var(--accent-blue)" }}>Register Setup Playbook</h3>
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "250px" }}>
                  <label className="label-text">Setup Name / Tag</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    placeholder="e.g. VWAP Bounce, Opening Range Breakout" 
                  />
                </div>
                <div style={{ flex: 1, minWidth: "250px" }}>
                  <label className="label-text">Brief Description</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the mathematical or behavioral edge" 
                  />
                </div>
              </div>
              <div>
                <label className="label-text">Playbook Entry Guidelines (one per line)</label>
                <textarea 
                  className="input-field" 
                  rows={4}
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  placeholder="Rule 1: Look for VIX above 18&#10;Rule 2: Entry on 5-min candle close above SMA&#10;Rule 3: Cut trade immediately if key level fails"
                  style={{ resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
              <div style={{ display: "flex", gap: "12px", alignSelf: "flex-end" }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAddPlaybook(false)} style={{ padding: "8px 16px", fontSize: "0.8rem" }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={isCreatingPlaybook} style={{ padding: "8px 16px", fontSize: "0.8rem" }}>
                  {isCreatingPlaybook ? "Saving..." : "Add to Playbook"}
                </button>
              </div>
            </form>
          )}

          {/* Expectancy Chart section */}
          <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <h3 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Volatility Regime Expectancy</h3>
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                Comparing average trade expectancy (in R-multiples) for your setups across Low Volatility vs High Volatility states.
              </p>
            </div>
            
            {chartData.length > 0 ? (
              <div style={{ width: "100%", height: "300px", marginTop: "10px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(74, 120, 152, 0.08)" />
                    <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={11} tickLine={false} />
                    <YAxis stroke="var(--text-secondary)" fontSize={11} tickLine={false} label={{ value: "Expectancy (R)", angle: -90, position: "insideLeft", fill: "var(--text-secondary)", offset: 10 }} />
                    <Tooltip 
                      contentStyle={{ background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", fontSize: "12px", color: "var(--text-primary)" }}
                      itemStyle={{ color: "var(--text-primary)" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
                    <Bar dataKey="Low Volatility (R)" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="High Volatility (R)" fill="var(--accent-gold)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-secondary)", fontSize: "0.85rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                <HelpCircle size={32} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
                <div>No closed trades with setup tags logged yet to calculate regime expectancy.</div>
                <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>Log trades on the main dashboard with tags (e.g. Breakout, Mean Reversion) to build analytics.</div>
              </div>
            )}
          </div>

          {/* Playbooks List registry */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 600 }}>Your Active Setup Playbooks</h3>
            
            {playbooks.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
                {playbooks.map((play) => (
                  <div key={play.playbook_id} className="glass-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "14px" }}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--accent-blue)" }}>{play.setup_name}</span>
                        <Trophy size={14} style={{ color: "var(--accent-gold)" }} />
                      </div>
                      <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "6px", fontStyle: "italic" }}>
                        {play.description || "No description provided."}
                      </p>
                    </div>

                    {getRulesList(play.ruleset_json).length > 0 && (
                      <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "10px" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary)" }}>Guidelines:</span>
                        <ul style={{ margin: "4px 0 0 0", padding: 0 }}>
                          {getRulesList(play.ruleset_json).map((rule, idx) => (
                            <li key={idx} style={{ fontSize: "0.75rem", color: "var(--text-secondary)", listStyle: "none", paddingLeft: "12px", position: "relative", marginBottom: "4px" }}>
                              <span style={{ position: "absolute", left: 0, color: "var(--accent-blue)" }}>•</span>
                              {rule}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: "30px", textAlign: "center", color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                No setup playbooks defined yet. Click "Create Setup Playbook" above to write out your trading edges.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------
          SUB-TAB 2: AI WEEKLY AUDITS
          ---------------------------------------------------- */}
      {activeSubTab === "audits" && (
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "24px", alignItems: "start" }}>
          
          {/* Left panel: Suggest audit & list reports */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            
            {/* Generate card */}
            <div className="glass-panel glow-effect" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Brain size={20} style={{ color: "var(--accent-blue)" }} />
                <h4 style={{ fontSize: "0.85rem", fontWeight: 700 }}>Weekly Performance Audit</h4>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                Ready to review your recent trading performance? Have the AI coach construct a detailed statistical and behavioral analysis.
              </p>
              <button 
                className="btn-primary" 
                onClick={handleGenerateAudit} 
                disabled={isGeneratingReport}
                style={{ fontSize: "0.75rem", padding: "8px 12px", width: "100%" }}
              >
                {isGeneratingReport ? "Auditing Trades..." : "Generate Audit Report"}
              </button>
            </div>

            {/* Past Audits List */}
            <div className="glass-panel" style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "400px", overflowY: "auto" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary)" }}>Historical Audits</span>
              
              {reports.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {reports.map((rep) => {
                    const isSelected = selectedReport?.report_id === rep.report_id;
                    const dateStr = new Date(rep.created_at).toLocaleDateString();
                    return (
                      <button
                        key={rep.report_id}
                        onClick={() => setSelectedReport(rep)}
                        style={{
                          background: isSelected ? "var(--accent-bg)" : "transparent",
                          border: `1px solid ${isSelected ? "var(--accent-blue)" : "var(--border-color)"}`,
                          borderRadius: "8px",
                          padding: "10px",
                          textAlign: "left",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          width: "100%",
                          transition: "all var(--transition-fast)"
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-primary)" }}>Audit {dateStr}</span>
                          <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>
                            {new Date(rep.start_date).toLocaleDateString()} - {new Date(rep.end_date).toLocaleDateString()}
                          </span>
                        </div>
                        <ChevronRight size={14} style={{ color: isSelected ? "var(--accent-blue)" : "var(--text-muted)" }} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", padding: "10px 0" }}>
                  No historical audits generated yet.
                </span>
              )}
            </div>
          </div>

          {/* Right panel: Audit Report View */}
          <div className="glass-panel" style={{ minHeight: "500px", display: "flex", flexDirection: "column", gap: "16px" }}>
            {selectedReport ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "16px" }}>
                  <div>
                    <h3 style={{ fontSize: "1.15rem", fontWeight: 700 }} className="title-gradient">
                      Weekly Performance Audit & Roadmap
                    </h3>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                      Generated on {new Date(selectedReport.created_at).toLocaleString()} &bull; Date Range: {new Date(selectedReport.start_date).toLocaleDateString()} to {new Date(selectedReport.end_date).toLocaleDateString()}
                    </p>
                  </div>
                  <FileText size={20} style={{ color: "var(--accent-blue)" }} />
                </div>
                
                <div style={{ padding: "0 10px", maxHeight: "650px", overflowY: "auto" }}>
                  {renderMarkdown(selectedReport.summary_md)}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", padding: "80px 0", gap: "16px" }}>
                <Brain size={48} style={{ color: "var(--text-muted)", opacity: 0.3 }} />
                <div style={{ textAlign: "center" }}>
                  <h4 style={{ color: "var(--text-primary)", fontSize: "0.95rem", fontWeight: 600 }}>No Performance Audit Loaded</h4>
                  <p style={{ fontSize: "0.75rem", marginTop: "4px", maxWidth: "320px" }}>
                    Select an audit report from the historical catalog, or click "Generate Audit Report" to analyze your week.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
