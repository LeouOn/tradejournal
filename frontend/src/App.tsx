import { useState, useEffect, useCallback } from "react";
import { 
  TrendingUp, BarChart3, Calendar as CalendarIcon, 
  RefreshCw, Play, Brain, Activity, Settings as SettingsIcon,
  BookOpen
} from "lucide-react";
import Dashboard from "./components/Dashboard";
import type { Trade, Stats } from "./components/Dashboard";
import PerformanceCharts from "./components/PerformanceCharts";
import CalendarView from "./components/CalendarView";
import TradeReplay from "./components/TradeReplay";
import AICoach from "./components/AICoach";
import AppLayout, { useLayoutState } from "./components/AppLayout";
import Settings from "./components/Settings";
import MarketAnalysis from "./components/MarketAnalysis";
import type { RegimeData } from "./components/MarketAnalysis";
import Playbooks from "./components/Playbooks";
import { TrainingDojo } from "./components/TrainingDojo";
import { useSettings } from "./contexts/SettingsContext";
import { useToast } from "./contexts/ToastContext";

export default function App() {
  const { settings } = useSettings();
  const toast = useToast();
  const [activeCanvasComponent, setActiveCanvasComponent] = useState<string>("Dashboard");
  const [matchingEngine, setMatchingEngine] = useState<"FIFO" | "LIFO">("FIFO");
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [accountId, setAccountId] = useState<string>("");
  const [accountBalance, setAccountBalance] = useState<number>(50000);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<Stats>({
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
    ruleAdherenceRate: 1.0,
    costOfIndiscipline: 0,
  });

  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [coachInitialPrompt, setCoachInitialPrompt] = useState<string>("");
  const [marketRegime, setMarketRegime] = useState<RegimeData>({ regime_type: "Bullish - Low Volatility" });
  const [showMarketAnalysis, setShowMarketAnalysis] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connected" | "disconnected">("disconnected");
  const { viewMode, splitPercent, handleModeChange, handleSplitChange } = useLayoutState(40);

  // 1. Fetch or initialize default account
  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:5000/api/accounts");
      const data = await res.json();
      if (data && data.length > 0) {
        setAccountId(data[0].account_id);
        setAccountBalance(Number(data[0].initial_balance));
      } else {
        // Create default demo account
        const createRes = await fetch("http://localhost:5000/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_name: "Quantitative Prop Account",
            broker_name: "Interactive Brokers",
            initial_balance: 50000,
          }),
        });
        const newAcc = await createRes.json();
        setAccountId(newAcc.account_id);
        setAccountBalance(Number(newAcc.initial_balance));
      }
    } catch (e) {
      console.error("Failed to load account:", e);
    }
  }, []);

  // 2. Fetch trades & statistics
  const loadDashboardData = useCallback(async () => {
    if (!accountId) return;
    try {
      const tradesRes = await fetch(`http://localhost:5000/api/trades?accountId=${accountId}&matchingEngine=${matchingEngine}`);
      const tradesData = await tradesRes.json();
      setTrades(tradesData);

      const statsRes = await fetch(`http://localhost:5000/api/stats/${accountId}?matchingEngine=${matchingEngine}`);
      const statsData = await statsRes.json();
      setStats(statsData);

      const regimeRes = await fetch("http://localhost:5000/api/market/regime");
      const regimeData = await regimeRes.json();
      setMarketRegime(regimeData);
    } catch (e) {
      console.error("Error refreshing dashboard stats:", e);
    }
  }, [accountId, matchingEngine]);

  // Run on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAccount();
  }, [loadAccount]);

  // Run when accountId is set
  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadDashboardData();

      // Establish WebSocket connection for real-time live data syncing
      const ws = new WebSocket("ws://localhost:5000");

      ws.onopen = () => {
        setWsStatus("connected");
        console.log("Connected to Real-time WebSockets Server.");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("WebSocket event received:", data);
          // Auto refresh stats and trade logs on update triggers
          if (
            data.type === "TRADE_CREATED" || 
            data.type === "TRADE_UPDATED" || 
            data.type === "REGIME_SHIFT" || 
            data.type === "IRONBEAM_PARSED" ||
            data.type === "WEEKLY_REPORT_GENERATED"
          ) {
            loadDashboardData();
          }

          if (data.type === "REGIME_SHIFT") {
            setMarketRegime(data.regime);
            toast.info(`Market regime shifted to: ${data.regime.regime_type}`, "Market Regime Shift");
          } else if (data.type === "WEEKLY_REPORT_GENERATED") {
            toast.success("A new AI weekly performance audit report is available! Check the Playbooks & Audits tab.");
          } else if (data.type === "AUDIT_SUGGESTION") {
            toast.nudge(data.message, "AI Coach Suggestion");
          }
        } catch {
          // Parse fails
        }
      };

      ws.onclose = () => {
        setWsStatus("disconnected");
        console.log("Disconnected from WebSockets Server.");
      };

      return () => {
        ws.close();
      };
    }
  }, [accountId, loadDashboardData, toast]);

  const handleSelectTradeForReplay = (trade: Trade) => {
    setSelectedTrade(trade);
    setActiveCanvasComponent("TradeReplay");
  };

  const handleDiscussChart = (chartName: string, chartData: any) => {
    const prompt = `Coach, please analyze my ${chartName}. Here is the raw statistical data:\n\n${JSON.stringify(chartData, null, 2)}\n\nWhat are my behavioral leaks and what strict rules should I implement?`;
    setCoachInitialPrompt(prompt);
  };

  const handleDiscussTrade = (trade: Trade) => {
    const prompt = `Coach, I want to deep dive on this specific trade (${trade.symbol}). Here is the raw data:\n\n${JSON.stringify({ duration: trade.duration, pnl: trade.net_pnl, tags: trade.trade_tags, executions: trade.executions }, null, 2)}\n\nAnalyze my execution scaling and provide critical feedback on my behavior.`;
    setCoachInitialPrompt(prompt);
  };

  return (
    <div style={{ height: "100vh", display: "flex", color: "var(--text-primary)", background: "var(--bg-primary)", overflow: "hidden" }}>
      
      {/* Fallback Hamburger Menu */}
      {isMenuOpen && (
        <div style={{ position: "absolute", top: 60, left: 20, background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "10px", zIndex: 1000, display: "flex", flexDirection: "column", gap: "8px" }}>
           <button className="btn-secondary" onClick={() => { setActiveCanvasComponent("Dashboard"); setIsMenuOpen(false); }}>Dashboard</button>
           <button className="btn-secondary" onClick={() => { setActiveCanvasComponent("PerformanceCharts"); setIsMenuOpen(false); }}>Charts</button>
           <button className="btn-secondary" onClick={() => { setActiveCanvasComponent("Calendar"); setIsMenuOpen(false); }}>Calendar</button>
           <button className="btn-secondary" onClick={() => { setActiveCanvasComponent("Playbooks"); setIsMenuOpen(false); }}>Playbooks</button>
           <button className="btn-secondary" onClick={() => { setActiveCanvasComponent("TrainingDojo"); setIsMenuOpen(false); }}>Training Dojo</button>
           <button className="btn-secondary" onClick={() => { setActiveCanvasComponent("Settings"); setIsMenuOpen(false); }}>Settings</button>
        </div>
      )}

      <AppLayout
        viewMode={viewMode}
        splitPercent={splitPercent}
        onSplitChange={handleSplitChange}
        leftPane={
          <>
            {/* Antigravity header bar */}
            <div style={{ padding: "15px 20px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
              <button style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "4px" }} onClick={() => setIsMenuOpen(!isMenuOpen)}>
                <Activity style={{ color: "var(--accent-blue)" }} size={24} />
              </button>
              {viewMode !== "minimized" && (
                <h2 style={{ fontSize: "1.1rem", fontWeight: "bold" }} className="title-gradient">
                  ANTIGRAVITY OS
                </h2>
              )}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <AICoach 
                accountId={accountId} 
                onRefreshTrades={loadDashboardData} 
                initialPrompt={coachInitialPrompt}
                trades={trades}
                initialBalance={accountBalance}
                onMountWidget={(componentName) => setActiveCanvasComponent(componentName)}
                onToggleEngine={setMatchingEngine}
                onPaneModeChange={handleModeChange}
                paneMode={viewMode}
              />
            </div>
          </>
        }
        rightPane={
          <>
            {/* Header bar */}
            <header 
              style={{ 
                height: "60px", 
                borderBottom: "1px solid var(--border-color)", 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center", 
                padding: "0 20px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                {/* LENS TOGGLE */}
                <div style={{ display: "flex", background: "var(--bg-secondary)", borderRadius: "20px", padding: "4px", border: "1px solid var(--border-color)" }}>
                  <button 
                    onClick={() => setMatchingEngine("FIFO")}
                    style={{
                      padding: "4px 12px", borderRadius: "16px", border: "none", fontSize: "0.75rem", fontWeight: "600", cursor: "pointer",
                      background: matchingEngine === "FIFO" ? "var(--accent-bg-strong)" : "transparent",
                      color: matchingEngine === "FIFO" ? "var(--accent-blue)" : "var(--text-secondary)",
                      transition: "all 0.2s"
                    }}
                  >
                    Net Session
                  </button>
                  <button 
                    onClick={() => setMatchingEngine("LIFO")}
                    style={{
                      padding: "4px 12px", borderRadius: "16px", border: "none", fontSize: "0.75rem", fontWeight: "600", cursor: "pointer",
                      background: matchingEngine === "LIFO" ? "var(--accent-bg-strong)" : "transparent",
                      color: matchingEngine === "LIFO" ? "var(--accent-blue)" : "var(--text-secondary)",
                      transition: "all 0.2s"
                    }}
                  >
                    Execution Edge
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Market State:</span>
              <button
                className="glow-effect"
                onClick={() => setShowMarketAnalysis(true)}
                style={{ 
                  padding: "4px 10px", 
                  borderRadius: "16px", 
                  fontSize: "0.75rem", 
                  fontWeight: "600",
                  background: "var(--accent-bg)",
                  border: "1px solid var(--accent-blue)",
                  color: "var(--accent-blue)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {marketRegime.regime_type || "Unknown"}
              </button>
            </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "15px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: wsStatus === "connected" ? "var(--accent-green)" : "var(--accent-red)",
                    display: "inline-block"
                  }} />
                  <span>{wsStatus === "connected" ? "Sync Active" : "Offline"}</span>
                </div>
                <span>
                  Net Equity: <strong style={{ color: "var(--text-primary)" }}>${(accountBalance + trades.reduce((acc, t) => acc + Number(t.net_pnl), 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                </span>
              </div>
            </header>

            {/* Content Area viewport */}
            <main className="canvas-pane-animation" style={{ padding: "20px", overflowY: "auto", flex: 1 }}>
              {activeCanvasComponent === "Dashboard" && (
                <Dashboard 
                  accountId={accountId} 
                  trades={trades} 
                  stats={stats} 
                  initialBalance={accountBalance}
                  onRefresh={loadDashboardData}
                  onSelectTradeForReplay={handleSelectTradeForReplay}
                  onSetActiveTab={(tab) => setActiveCanvasComponent(tab === "dashboard" ? "Dashboard" : tab === "charts" ? "PerformanceCharts" : tab === "calendar" ? "Calendar" : tab === "playbooks" ? "Playbooks" : "Dashboard")}
                  onDiscussTrade={handleDiscussTrade}
                />
              )}

              {(activeCanvasComponent === "PerformanceCharts" || activeCanvasComponent === "DrawdownChart" || activeCanvasComponent === "TimeOfDayChart") && (
                <PerformanceCharts trades={trades} initialBalance={accountBalance} onDiscussChart={handleDiscussChart} />
              )}

              {activeCanvasComponent === "Calendar" && (
                <CalendarView trades={trades} accountId={accountId} />
              )}

              {activeCanvasComponent === "TradeReplay" && selectedTrade && (
                <TradeReplay key={selectedTrade.trade_id} trade={selectedTrade} />
              )}

              {activeCanvasComponent === "Playbooks" && (
                <Playbooks 
                  accountId={accountId} 
                  trades={trades} 
                  onRefreshTrades={loadDashboardData} 
                />
              )}

              {activeCanvasComponent === "TrainingDojo" && (
                <TrainingDojo />
              )}

              {activeCanvasComponent === "Settings" && (
                <Settings 
                  accountId={accountId} 
                  onAccountUpdated={() => {
                    loadAccount();
                    loadDashboardData();
                  }} 
                />
              )}
            </main>
          </>
        }
      />
      {showMarketAnalysis && (
        <MarketAnalysis regime={marketRegime} onClose={() => setShowMarketAnalysis(false)} />
      )}
    </div>
  );
}
