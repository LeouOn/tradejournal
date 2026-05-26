import { useState, useEffect } from "react";
import { 
  TrendingUp, BarChart3, Calendar as CalendarIcon, 
  RefreshCw, Play, Brain, Activity, Settings as SettingsIcon
} from "lucide-react";
import Dashboard from "./components/Dashboard";
import type { Trade, Stats } from "./components/Dashboard";
import PerformanceCharts from "./components/PerformanceCharts";
import CalendarView from "./components/CalendarView";
import TradeReplay from "./components/TradeReplay";
import AICoach from "./components/AICoach";
import Settings from "./components/Settings";
import MarketAnalysis from "./components/MarketAnalysis";
import { useSettings } from "./contexts/SettingsContext";

export default function App() {
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<string>("dashboard");
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
  const [marketRegime, setMarketRegime] = useState<Record<string, any>>({ regime_type: "Bullish - Low Volatility" });
  const [showMarketAnalysis, setShowMarketAnalysis] = useState(false);
  const [wsStatus, setWsStatus] = useState<"connected" | "disconnected">("disconnected");

  // 1. Fetch or initialize default account
  const loadAccount = async () => {
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
  };

  // 2. Fetch trades & statistics
  const loadDashboardData = async () => {
    if (!accountId) return;
    try {
      const tradesRes = await fetch(`http://localhost:5000/api/trades?accountId=${accountId}`);
      const tradesData = await tradesRes.json();
      setTrades(tradesData);

      const statsRes = await fetch(`http://localhost:5000/api/stats/${accountId}`);
      const statsData = await statsRes.json();
      setStats(statsData);

      const regimeRes = await fetch("http://localhost:5000/api/market/regime");
      const regimeData = await regimeRes.json();
      setMarketRegime(regimeData);
    } catch (e) {
      console.error("Error refreshing dashboard stats:", e);
    }
  };

  // Run on mount
  useEffect(() => {
    loadAccount();
  }, []);

  // Run when accountId is set
  useEffect(() => {
    if (accountId) {
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
            data.type === "IRONBEAM_PARSED"
          ) {
            loadDashboardData();
          }
        } catch (e) {
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
  }, [accountId]);

  const handleSelectTradeForReplay = (trade: Trade) => {
    setSelectedTrade(trade);
    setActiveTab("replay");
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar navigation */}
      <div 
        className="glass-panel" 
        style={{ 
          width: settings.compactSidebar ? "200px" : "260px", 
          borderRadius: "0px", 
          borderRight: "1px solid var(--border-color)", 
          borderTop: "none", 
          borderBottom: "none", 
          borderLeft: "none",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "24px 16px",
          transition: "width var(--transition-normal)"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
          {/* App title logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Activity style={{ color: "var(--accent-blue)" }} size={24} />
            <h2 style={{ fontSize: "1.2rem", fontWeight: "bold" }} className="title-gradient">
              ANTIGRAVITY JOURNAL
            </h2>
          </div>

          {/* Navigation Links */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              className={`btn-secondary`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                textAlign: "left",
                justifyContent: "flex-start",
                borderColor: activeTab === "dashboard" ? "var(--accent-blue)" : "transparent",
                background: activeTab === "dashboard" ? "var(--accent-bg)" : "transparent"
              }}
              onClick={() => setActiveTab("dashboard")}
            >
              <TrendingUp size={18} />
              Performance Dashboard
            </button>

            <button
              className={`btn-secondary`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                textAlign: "left",
                justifyContent: "flex-start",
                borderColor: activeTab === "charts" ? "var(--accent-blue)" : "transparent",
                background: activeTab === "charts" ? "var(--accent-bg)" : "transparent"
              }}
              onClick={() => setActiveTab("charts")}
            >
              <BarChart3 size={18} />
              Equity & Analytics
            </button>

            <button
              className={`btn-secondary`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                textAlign: "left",
                justifyContent: "flex-start",
                borderColor: activeTab === "calendar" ? "var(--accent-blue)" : "transparent",
                background: activeTab === "calendar" ? "var(--accent-bg)" : "transparent"
              }}
              onClick={() => setActiveTab("calendar")}
            >
              <CalendarIcon size={18} />
              Calendar Grid
            </button>

            <button
              className={`btn-secondary`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                textAlign: "left",
                justifyContent: "flex-start",
                borderColor: activeTab === "coach" ? "var(--accent-blue)" : "transparent",
                background: activeTab === "coach" ? "var(--accent-bg)" : "transparent"
              }}
              onClick={() => setActiveTab("coach")}
            >
              <Brain size={18} />
              AI Quant Coach
            </button>

            <button
              className={`btn-secondary`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                textAlign: "left",
                justifyContent: "flex-start",
                borderColor: activeTab === "replay" ? "var(--accent-blue)" : "transparent",
                background: activeTab === "replay" ? "var(--accent-bg)" : "transparent"
              }}
              onClick={() => {
                if (trades.filter(t => t.executions.length >= 2).length === 0) {
                  alert("No trades with multiple entry/exit executions logged yet. Add some executions first!");
                  return;
                }
                const firstReplayable = trades.find(t => t.executions.length >= 2);
                if (firstReplayable) setSelectedTrade(firstReplayable);
                setActiveTab("replay");
              }}
            >
              <Play size={18} />
              Trade Execution Replay
            </button>

            <button
              className={`btn-secondary`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                textAlign: "left",
                justifyContent: "flex-start",
                borderColor: activeTab === "settings" ? "var(--accent-blue)" : "transparent",
                background: activeTab === "settings" ? "var(--accent-bg)" : "transparent"
              }}
              onClick={() => setActiveTab("settings")}
            >
              <SettingsIcon size={18} />
              Settings
            </button>
          </div>
        </div>

        {/* Sync status widget */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            <span style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: wsStatus === "connected" ? "var(--accent-green)" : "var(--accent-red)",
              display: "inline-block"
            }} />
            <span>Feed: {wsStatus === "connected" ? "Sync Active" : "Offline"}</span>
          </div>
          <button 
            className="btn-secondary" 
            style={{ padding: "6px", fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
            onClick={loadDashboardData}
          >
            <RefreshCw size={12} />
            Force Refresh Sync
          </button>
        </div>
      </div>

      {/* Main Panel Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
        {/* Header bar */}
        <header 
          style={{ 
            height: "70px", 
            borderBottom: "1px solid var(--border-color)", 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center", 
            padding: "0 30px" 
          }}
        >
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
              <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>inspect</span>
            </button>
          </div>

          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            Account Net Equity: <strong style={{ color: "var(--text-primary)" }}>${(accountBalance + trades.reduce((acc, t) => acc + Number(t.net_pnl), 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          </div>
        </header>

        {/* Content Area viewport */}
        <main style={{ padding: "30px", overflowY: "auto", flex: 1 }}>
          {activeTab === "dashboard" && (
            <Dashboard 
              accountId={accountId} 
              trades={trades} 
              stats={stats} 
              initialBalance={accountBalance}
              onRefresh={loadDashboardData}
              onSelectTradeForReplay={handleSelectTradeForReplay}
              onSetActiveTab={setActiveTab}
            />
          )}

          {activeTab === "charts" && (
            <PerformanceCharts trades={trades} initialBalance={accountBalance} />
          )}

          {activeTab === "calendar" && (
            <CalendarView trades={trades} accountId={accountId} />
          )}

          {activeTab === "replay" && selectedTrade && (
            <TradeReplay trade={selectedTrade} />
          )}

          {activeTab === "coach" && (
            <AICoach accountId={accountId} onRefreshTrades={loadDashboardData} />
          )}

          {activeTab === "settings" && (
            <Settings />
          )}
        </main>
      </div>
      {showMarketAnalysis && (
        <MarketAnalysis regime={marketRegime} onClose={() => setShowMarketAnalysis(false)} />
      )}
    </div>
  );
}
