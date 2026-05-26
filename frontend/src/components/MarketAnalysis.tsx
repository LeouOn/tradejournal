import { useState } from "react";
import { X, TrendingUp, TrendingDown, Activity, BarChart3, Shield, AlertTriangle } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

export interface RegimeData {
  regime_type?: string;
  vix_level?: number;
  fed_funds_rate?: number;
  spx_trend?: string;
  spx_close?: number;
  spx_200sma?: number;
  spx_dist_200sma?: number;
  atr_ratio?: number;
  spx_5d_return?: number;
  spx_20d_return?: number;
  spx_60d_return?: number;
  vix_percentile?: number;
  regime_date?: string;
  regime_description?: string;
  state_profiles?: {
    name: string;
    avg_vix: number;
    avg_return: number;
    avg_dist_200sma: number;
    pct_of_history: number;
    is_current: boolean;
  }[];
}

interface Props {
  regime: RegimeData;
  onClose: () => void;
}

function regimeColor(regime: string) {
  if (regime.includes("Bullish") && regime.includes("Low")) return "var(--accent-green)";
  if (regime.includes("Bullish") && regime.includes("High")) return "var(--accent-gold)";
  if (regime.includes("Bearish") && regime.includes("Low")) return "var(--accent-blue)";
  return "var(--accent-red)";
}

export default function MarketAnalysis({ regime, onClose }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const toast = useToast();

  const handleTriggerHMM = async () => {
    setIsRunning(true);
    toast.info("Triggered Hidden Markov Model classification in the background...", "Market Regime Pipeline");
    try {
      const res = await fetch("http://localhost:5000/api/market/regime/trigger", {
        method: "POST",
      });
      if (res.ok) {
        toast.success("HMM regime calculation spawned! Results will broadcast on completion.");
      } else {
        toast.error("Failed to trigger HMM regime script.");
      }
    } catch {
      toast.error("Network error triggering HMM script.");
    } finally {
      setIsRunning(false);
    }
  };

  const color = regimeColor(regime.regime_type || "");
  const profiles = regime.state_profiles || [];
  const hasLiveData = regime.spx_close !== undefined && regime.spx_close !== 5800;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay-bg)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width: "780px",
          maxHeight: "85vh",
          overflowY: "auto",
          padding: "28px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Market Regime Analysis {regime.regime_date ? `· ${regime.regime_date}` : ""}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div
                style={{
                  padding: "8px",
                  borderRadius: "10px",
                  background: `${color}15`,
                  border: `1px solid ${color}40`,
                }}
              >
                {(regime.regime_type || "").includes("Bullish") ? (
                  <TrendingUp size={22} style={{ color }} />
                ) : (regime.regime_type || "").includes("Bearish") && (regime.regime_type || "").includes("High") ? (
                  <AlertTriangle size={22} style={{ color }} />
                ) : (
                  <TrendingDown size={22} style={{ color }} />
                )}
              </div>
              <h2 style={{ fontSize: "1.3rem", fontWeight: 700, color }}>{regime.regime_type}</h2>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "4px" }}>
            <X size={20} />
          </button>
        </div>

        {regime.regime_description && (
          <div style={{ background: "var(--accent-bg)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px", marginBottom: "20px", fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {regime.regime_description}
          </div>
        )}

        {!hasLiveData && (
          <div style={{ background: "var(--gold-bg)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px", marginBottom: "20px", fontSize: "0.82rem", color: "var(--accent-gold)" }}>
            Showing default values. Run <code style={{ background: "var(--bg-tertiary)", padding: "2px 6px", borderRadius: "4px" }}>npm run ml:run</code> to populate with live market data from Yahoo Finance and FRED.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", background: "var(--neutral-bg)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "12px 16px" }}>
          <div>
            <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Hidden Markov Model Classifier</div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "2px" }}>Train model on 5 years of daily data to classify market states.</div>
          </div>
          <button 
            className="btn-primary" 
            onClick={handleTriggerHMM} 
            disabled={isRunning}
            style={{ fontSize: "0.75rem", padding: "6px 12px" }}
          >
            {isRunning ? "Running ML..." : "Recalculate HMM Regime"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "20px" }}>
          <MetricCard icon={<Activity size={16} />} label="VIX Level" value={`${regime.vix_level?.toFixed(1) ?? "—"}`} detail={regime.vix_percentile != null ? `${regime.vix_percentile.toFixed(0)}th percentile (5Y)` : undefined} color={(regime.vix_level ?? 0) > 25 ? "var(--accent-red)" : (regime.vix_level ?? 0) > 18 ? "var(--accent-gold)" : "var(--accent-green)"} />
          <MetricCard icon={<BarChart3 size={16} />} label="S&P 500" value={regime.spx_close != null ? regime.spx_close.toFixed(0) : "—"} detail={regime.spx_trend?.replace(/_/g, " ")} />
          <MetricCard icon={<Shield size={16} />} label="Fed Funds Rate" value={`${regime.fed_funds_rate?.toFixed(2) ?? "—"}%`} detail="Effective rate" />
          <MetricCard icon={<Activity size={16} />} label="ATR Ratio" value={regime.atr_ratio != null ? `${regime.atr_ratio.toFixed(2)}%` : "—"} detail="20-day avg true range / price" color={(regime.atr_ratio ?? 0) > 2 ? "var(--accent-red)" : undefined} />
        </div>

        {(regime.spx_200sma != null || regime.spx_5d_return != null) && (
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "0.9rem", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
              <TrendingUp size={15} style={{ color: "var(--accent-blue)" }} />
              S&P 500 Technical Position
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
              <MiniStat label="200 SMA" value={regime.spx_200sma != null ? regime.spx_200sma.toFixed(0) : "—"} />
              <MiniStat label="Distance from 200" value={regime.spx_dist_200sma != null ? `${regime.spx_dist_200sma > 0 ? "+" : ""}${regime.spx_dist_200sma.toFixed(1)}%` : "—"} color={regime.spx_dist_200sma != null ? (regime.spx_dist_200sma >= 0 ? "var(--accent-green)" : "var(--accent-red)") : undefined} />
              <MiniStat label="5D Return" value={regime.spx_5d_return != null ? `${regime.spx_5d_return > 0 ? "+" : ""}${regime.spx_5d_return.toFixed(2)}%` : "—"} color={regime.spx_5d_return != null ? (regime.spx_5d_return >= 0 ? "var(--accent-green)" : "var(--accent-red)") : undefined} />
              <MiniStat label="20D Return" value={regime.spx_20d_return != null ? `${regime.spx_20d_return > 0 ? "+" : ""}${regime.spx_20d_return.toFixed(2)}%` : "—"} color={regime.spx_20d_return != null ? (regime.spx_20d_return >= 0 ? "var(--accent-green)" : "var(--accent-red)") : undefined} />
              <MiniStat label="60D Return" value={regime.spx_60d_return != null ? `${regime.spx_60d_return > 0 ? "+" : ""}${regime.spx_60d_return.toFixed(2)}%` : "—"} color={regime.spx_60d_return != null ? (regime.spx_60d_return >= 0 ? "var(--accent-green)" : "var(--accent-red)") : undefined} />
              <MiniStat label="Trend Signal" value={regime.spx_trend?.replace(/_/g, " ") ?? "—"} color={regime.spx_trend === "ABOVE_200SMA" ? "var(--accent-green)" : "var(--accent-red)"} />
            </div>
          </div>
        )}

        {profiles.length > 0 && (
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "0.9rem", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
              <BarChart3 size={15} style={{ color: "var(--accent-blue)" }} />
              HMM State Profiles (5-Year Historical)
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {profiles.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 80px 80px 80px 1fr 24px",
                    alignItems: "center",
                    gap: "8px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: s.is_current ? "var(--accent-bg-strong)" : "var(--input-bg)",
                    border: s.is_current ? "1px solid var(--accent-blue)" : "1px solid var(--border-color)",
                    fontSize: "0.8rem",
                  }}
                >
                  <div style={{ fontWeight: 600, color: s.is_current ? "var(--accent-blue)" : "var(--text-primary)" }}>
                    {s.name} {s.is_current && <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>(current)</span>}
                  </div>
                  <div>
                    <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>VIX</span><br />
                    <span>{s.avg_vix.toFixed(1)}</span>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>Return</span><br />
                    <span style={{ color: s.avg_return >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>{s.avg_return > 0 ? "+" : ""}{s.avg_return.toFixed(3)}%</span>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>vs 200SMA</span><br />
                    <span style={{ color: s.avg_dist_200sma >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>{s.avg_dist_200sma > 0 ? "+" : ""}{s.avg_dist_200sma.toFixed(1)}%</span>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ flex: 1, height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(s.pct_of_history, 100)}%`, height: "100%", background: s.is_current ? "var(--accent-blue)" : "var(--text-secondary)", borderRadius: "2px" }} />
                      </div>
                      <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem", minWidth: "32px" }}>{s.pct_of_history.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div>
                    {s.is_current && (
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-blue)", boxShadow: "0 0 8px var(--glow-color-strong)" }} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: "var(--input-bg)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px", fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
          <strong style={{ color: "var(--text-primary)" }}>How This Works</strong>
          <div style={{ marginTop: "6px" }}>
            The regime is classified by a <strong style={{ color: "var(--text-primary)" }}>4-state Gaussian Hidden Markov Model</strong> trained on 5 years of daily S&P 500 data.
            The HMM ingests four features: daily log returns, VIX close, distance from 200-day SMA (%), and 20-day ATR ratio.
            States are dynamically labeled by sorting on average VIX level, then assigning bullish/bearish based on mean return direction.
            The model runs via <code style={{ background: "var(--bg-tertiary)", padding: "1px 4px", borderRadius: "3px" }}>npm run ml:run</code> and pushes results to the backend, which broadcasts regime shifts over WebSocket in real time.
            FRED Fed Funds data is sourced from the St. Louis Fed API (or mock fallback if no API key is configured).
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, detail, color }: { icon: React.ReactNode; label: string; value: string; detail?: string; color?: string }) {
  return (
    <div style={{ background: "var(--input-bg)", border: "1px solid var(--border-color)", borderRadius: "8px", padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
        <span style={{ color: "var(--text-secondary)" }}>{icon}</span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{label}</span>
      </div>
      <div style={{ fontSize: "1.2rem", fontWeight: 700, color: color || "var(--text-primary)" }}>{value}</div>
      {detail && <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "2px" }}>{detail}</div>}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "var(--input-bg)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "8px 10px" }}>
      <div style={{ fontSize: "0.65rem", color: "var(--text-secondary)", marginBottom: "2px" }}>{label}</div>
      <div style={{ fontSize: "0.85rem", fontWeight: 600, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );
}
