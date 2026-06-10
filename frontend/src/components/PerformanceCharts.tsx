import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ScatterChart, Scatter, ZAxis
} from "recharts";
import { Brain } from "lucide-react";
import type { Trade } from "./Dashboard";

interface PerformanceChartsProps {
  trades: Trade[];
  initialBalance: number;
  onDiscussChart?: (chartName: string, chartData: any) => void;
}

export default function PerformanceCharts({ trades, initialBalance, onDiscussChart }: PerformanceChartsProps) {
  // Sort trades chronologically
  const sortedTrades = [...trades]
    .filter((t) => t.status === "CLOSED")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // 1. Calculate Cumulative P&L timeline data
  let chartData: any[] = [];
  let rollingPnl = 0;
  let rollingWins = 0;
  let runningProfits = 0;
  let runningLosses = 0;
  let peakBalance = initialBalance;

  for (let index = 0; index < sortedTrades.length; index++) {
    const t = sortedTrades[index];
    const pnl = Number(t.net_pnl);
    rollingPnl += pnl;
    
    if (pnl > 0.001) {
      rollingWins++;
      runningProfits += pnl;
    } else if (pnl < -0.001) {
      runningLosses += Math.abs(pnl);
    }

    const totalCalculated = index + 1;
    const rollingWinRate = totalCalculated > 0 ? (rollingWins / totalCalculated) * 100 : 0;
    const rollingPF = runningLosses > 0 ? runningProfits / runningLosses : runningProfits > 0 ? 10 : 0;

    const currentBalance = initialBalance + rollingPnl;
    peakBalance = Math.max(peakBalance, currentBalance);
    const drawdownValue = currentBalance - peakBalance;
    const drawdownPercent = peakBalance > 0 ? (drawdownValue / peakBalance) * 100 : 0;

    chartData.push({
      name: `Trade #${totalCalculated}`,
      symbol: t.symbol,
      pnl: pnl,
      cumulativePnl: rollingPnl,
      balance: currentBalance,
      drawdown: Number(drawdownValue.toFixed(2)),
      drawdownPct: Number(drawdownPercent.toFixed(2)),
      winRate: Math.round(rollingWinRate),
      profitFactor: Number(rollingPF.toFixed(2)),
    });
  }

  // 1b. Time of Day Performance
  const todBuckets: Record<string, { count: number, pnl: number }> = {};
  sortedTrades.forEach(t => {
    const d = new Date(t.created_at);
    // Group into 1-hour blocks, formatting as "HH:00"
    const hour = d.getHours().toString().padStart(2, '0');
    const label = `${hour}:00`;
    if (!todBuckets[label]) todBuckets[label] = { count: 0, pnl: 0 };
    todBuckets[label].count++;
    todBuckets[label].pnl += Number(t.net_pnl);
  });
  const todChartData = Object.keys(todBuckets).sort().map(key => ({
    time: key,
    pnl: Number(todBuckets[key].pnl.toFixed(2)),
    count: todBuckets[key].count
  }));

  // 1c. Duration vs PnL Scatter
  const scatterData = sortedTrades.map(t => ({
    name: t.trade_id,
    durationMin: Number((t.duration / 60).toFixed(1)),
    pnl: Number(t.net_pnl),
    type: Number(t.net_pnl) > 0 ? "Win" : "Loss"
  }));

  // Group closed trades by calendar day for Overtrading Analytics
  const dailyTrades: { [date: string]: Trade[] } = {};
  sortedTrades.forEach((t) => {
    const d = new Date(t.created_at).toLocaleDateString();
    if (!dailyTrades[d]) dailyTrades[d] = [];
    dailyTrades[d].push(t);
  });

  const overtradingBuckets = {
    low: { name: "1-2 Trades", daysCount: 0, totalPnl: 0 },
    mid: { name: "3-4 Trades", daysCount: 0, totalPnl: 0 },
    high: { name: "5+ Trades", daysCount: 0, totalPnl: 0 }
  };

  Object.keys(dailyTrades).forEach((date) => {
    const count = dailyTrades[date].length;
    const pnl = dailyTrades[date].reduce((sum, t) => sum + Number(t.net_pnl), 0);
    if (count <= 2) {
      overtradingBuckets.low.daysCount++;
      overtradingBuckets.low.totalPnl += pnl;
    } else if (count <= 4) {
      overtradingBuckets.mid.daysCount++;
      overtradingBuckets.mid.totalPnl += pnl;
    } else {
      overtradingBuckets.high.daysCount++;
      overtradingBuckets.high.totalPnl += pnl;
    }
  });

  const overtradingChartData = [
    {
      name: "Low (1-2)",
      avgPnl: overtradingBuckets.low.daysCount > 0 ? Number((overtradingBuckets.low.totalPnl / overtradingBuckets.low.daysCount).toFixed(2)) : 0,
      days: overtradingBuckets.low.daysCount
    },
    {
      name: "Mid (3-4)",
      avgPnl: overtradingBuckets.mid.daysCount > 0 ? Number((overtradingBuckets.mid.totalPnl / overtradingBuckets.mid.daysCount).toFixed(2)) : 0,
      days: overtradingBuckets.mid.daysCount
    },
    {
      name: "High (5+)",
      avgPnl: overtradingBuckets.high.daysCount > 0 ? Number((overtradingBuckets.high.totalPnl / overtradingBuckets.high.daysCount).toFixed(2)) : 0,
      days: overtradingBuckets.high.daysCount
    }
  ];

  // Dynamic overtrading text warning
  let overtradingText = "Maintain a disciplined daily trade frequency. Overtrading often degrades average performance per trade.";
  let overtradingWarningColor = "var(--text-secondary)";
  if (overtradingBuckets.high.daysCount > 0) {
    const highAvg = overtradingBuckets.high.totalPnl / overtradingBuckets.high.daysCount;
    const lowAvg = overtradingBuckets.low.daysCount > 0 ? overtradingBuckets.low.totalPnl / overtradingBuckets.low.daysCount : 0;
    if (highAvg < lowAvg) {
      overtradingText = `Warning: Your average daily P&L on high-frequency days (5+ trades) is $${highAvg.toFixed(2)} compared to $${lowAvg.toFixed(2)} on low-frequency days (1-2 trades). Statistical evidence indicates overtrading significantly harms your performance. Consider walking away after 3 trades.`;
      overtradingWarningColor = "var(--accent-red)";
    } else {
      overtradingText = `Notice: High frequency days (5+ trades) average $${highAvg.toFixed(2)} daily return. Keep managing risk boundaries.`;
      overtradingWarningColor = "var(--accent-green)";
    }
  }

  // Setup Type comparison (Breakouts vs Range Trades)
  let breakoutCount = 0;
  let breakoutWins = 0;
  let breakoutPnl = 0;

  let rangeCount = 0;
  let rangeWins = 0;
  let rangePnl = 0;

  sortedTrades.forEach((t) => {
    const pnl = Number(t.net_pnl);
    const isWin = pnl > 0.001;
    const type = (t.trade_type || "BREAKOUT").toUpperCase();

    if (type === "BREAKOUT") {
      breakoutCount++;
      breakoutPnl += pnl;
      if (isWin) breakoutWins++;
    } else if (type === "RANGE") {
      rangeCount++;
      rangePnl += pnl;
      if (isWin) rangeWins++;
    }
  });

  const setupChartData = [
    {
      name: "Breakouts",
      pnl: Number(breakoutPnl.toFixed(2)),
      winRate: breakoutCount > 0 ? Math.round((breakoutWins / breakoutCount) * 100) : 0,
      count: breakoutCount
    },
    {
      name: "Range Trades",
      pnl: Number(rangePnl.toFixed(2)),
      winRate: rangeCount > 0 ? Math.round((rangeWins / rangeCount) * 100) : 0,
      count: rangeCount
    }
  ];

  // Bias performance & reversals
  let longCount = 0, longWins = 0, longPnl = 0;
  let shortCount = 0, shortWins = 0, shortPnl = 0;
  let rangeBiasCount = 0, rangeBiasWins = 0, rangeBiasPnl = 0;

  let revCount = 0, revWins = 0, revPnl = 0;
  let normalCount = 0, normalWins = 0, normalPnl = 0;

  sortedTrades.forEach((t) => {
    const pnl = Number(t.net_pnl);
    const isWin = pnl > 0.001;
    const biasVal = (t.bias || "RANGE").toUpperCase();

    if (biasVal === "LONG") {
      longCount++;
      longPnl += pnl;
      if (isWin) longWins++;
    } else if (biasVal === "SHORT") {
      shortCount++;
      shortPnl += pnl;
      if (isWin) shortWins++;
    } else {
      rangeBiasCount++;
      rangeBiasPnl += pnl;
      if (isWin) rangeBiasWins++;
    }

    if (t.bias_reversal) {
      revCount++;
      revPnl += pnl;
      if (isWin) revWins++;
    } else {
      normalCount++;
      normalPnl += pnl;
      if (isWin) normalWins++;
    }
  });

  const biasChartData = [
    { name: "Long Bias", pnl: Number(longPnl.toFixed(2)), winRate: longCount > 0 ? Math.round((longWins / longCount) * 100) : 0 },
    { name: "Short Bias", pnl: Number(shortPnl.toFixed(2)), winRate: shortCount > 0 ? Math.round((shortWins / shortCount) * 100) : 0 },
    { name: "Range Bias", pnl: Number(rangeBiasPnl.toFixed(2)), winRate: rangeBiasCount > 0 ? Math.round((rangeBiasWins / rangeBiasCount) * 100) : 0 }
  ];

  const reversalChartData = [
    { name: "Aligned", pnl: Number(normalPnl.toFixed(2)), winRate: normalCount > 0 ? Math.round((normalWins / normalCount) * 100) : 0 },
    { name: "Reversed", pnl: Number(revPnl.toFixed(2)), winRate: revCount > 0 ? Math.round((revWins / revCount) * 100) : 0 }
  ];



  if (chartData.length === 0) {
    return (
      <div className="glass-panel" style={{ height: "300px", display: "flex", justifyContent: "center", alignItems: "center", color: "var(--text-secondary)" }}>
        Not enough historical data to generate performance curves. Log closed trades first.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* 1. Cumulative Equity Curve */}
      <div className="glass-panel">
        <h3 style={{ marginBottom: "16px", fontSize: "1.1rem" }}>Account Equity Curve & Cumulative P&L</h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.4}/>
                  <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
              <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={11} />
              <YAxis stroke="var(--text-secondary)" fontSize={11} domain={['dataMin - 500', 'dataMax + 500']} tickFormatter={(v) => `$${v}`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="balance" stroke="var(--accent-blue)" strokeWidth={2} fillOpacity={1} fill="url(#colorPnl)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. Advanced Equity & Drawdown */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
        {/* Drawdown Curve */}
        <div className="glass-panel" style={{ position: "relative" }}>
          {onDiscussChart && (
            <button className="btn-secondary" style={{ position: "absolute", top: "16px", right: "16px", padding: "4px 8px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "6px" }}
              onClick={() => onDiscussChart("Drawdown Curve", chartData.map(d => ({ trade: d.name, drawdown: d.drawdown, drawdownPct: d.drawdownPct })))}>
              <Brain size={14} style={{ color: "var(--accent-blue)" }} /> Discuss Chart
            </button>
          )}
          <h3 style={{ marginBottom: "16px", fontSize: "1.1rem" }}>Drawdown from Peak ($)</h3>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorDrawdown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-red)" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="var(--accent-red)" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                <YAxis stroke="var(--text-secondary)" fontSize={10} domain={['dataMin', 0]} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: number) => [`$${v}`, "Drawdown"]} />
                <Area type="monotone" dataKey="drawdown" stroke="var(--accent-red)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorDrawdown)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Rolling Win Rate */}
        <div className="glass-panel" style={{ position: "relative" }}>
          <h3 style={{ marginBottom: "16px", fontSize: "1.1rem" }}>Rolling Win Rate % Evolution</h3>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                <YAxis stroke="var(--text-secondary)" fontSize={10} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip />
                <Line type="monotone" dataKey="winRate" stroke="var(--accent-green)" strokeWidth={1.5} dot={false} name="Win Rate" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 2b. Time of Day and Scatter Plots */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
        {/* Time of Day Performance */}
        <div className="glass-panel" style={{ position: "relative" }}>
          {onDiscussChart && (
            <button className="btn-secondary" style={{ position: "absolute", top: "16px", right: "16px", padding: "4px 8px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "6px" }}
              onClick={() => onDiscussChart("Time of Day Performance", todChartData)}>
              <Brain size={14} style={{ color: "var(--accent-blue)" }} /> Discuss Chart
            </button>
          )}
          <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Time of Day Performance</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Total P&L bucketed by the hour trades were initiated.
          </p>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={todChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
                <XAxis dataKey="time" stroke="var(--text-secondary)" fontSize={10} />
                <YAxis stroke="var(--text-secondary)" fontSize={10} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: number, name: string) => [name === "pnl" ? `$${v}` : v, name === "pnl" ? "Total P&L" : "Trades"]} />
                <Bar dataKey="pnl" name="Total P&L" radius={[4, 4, 0, 0]}>
                  {todChartData.map((entry, index) => {
                    const color = entry.pnl > 0 ? "var(--accent-green)" : entry.pnl < 0 ? "var(--accent-red)" : "var(--accent-gold)";
                    return <Cell key={`cell-${index}`} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Trade Duration vs PnL Scatter Plot */}
        <div className="glass-panel" style={{ position: "relative" }}>
          {onDiscussChart && (
            <button className="btn-secondary" style={{ position: "absolute", top: "16px", right: "16px", padding: "4px 8px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "6px" }}
              onClick={() => onDiscussChart("Duration vs PnL Scatter", scatterData)}>
              <Brain size={14} style={{ color: "var(--accent-blue)" }} /> Discuss Chart
            </button>
          )}
          <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Trade Duration vs P&L</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Holding time (minutes) plotted against P&L. Are you cutting winners too quickly?
          </p>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
                <XAxis type="number" dataKey="durationMin" name="Duration" unit="m" stroke="var(--text-secondary)" fontSize={10} />
                <YAxis type="number" dataKey="pnl" name="PnL" unit="$" stroke="var(--text-secondary)" fontSize={10} />
                <ZAxis range={[30, 30]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Scatter name="Wins" data={scatterData.filter(d => d.type === "Win")} fill="var(--accent-green)" />
                <Scatter name="Losses" data={scatterData.filter(d => d.type === "Loss")} fill="var(--accent-red)" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 3. Advanced Behavioral Analytics Section */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
        
        {/* Overtrading Impact (Daily Trade Count vs Average Day P&L) */}
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative" }}>
          {onDiscussChart && (
            <button className="btn-secondary" style={{ position: "absolute", top: "16px", right: "16px", padding: "4px 8px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "6px", zIndex: 10 }}
              onClick={() => onDiscussChart("Overtrading Impact", overtradingChartData)}>
              <Brain size={14} style={{ color: "var(--accent-blue)" }} /> Discuss Chart
            </button>
          )}
          <div>
            <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Overtrading Impact</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
              Average daily P&L grouped by how many trades were executed.
            </p>
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={overtradingChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
                  <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                  <YAxis stroke="var(--text-secondary)" fontSize={10} />
                  <Tooltip formatter={(value) => [`$${value}`, "Avg P&L"]} />
                  <Bar dataKey="avgPnl" radius={[4, 4, 0, 0]}>
                    {overtradingChartData.map((entry, index) => {
                      const color = entry.avgPnl > 0 ? "var(--accent-green)" : entry.avgPnl < 0 ? "var(--accent-red)" : "var(--accent-gold)";
                      return <Cell key={`cell-${index}`} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{
            fontSize: "0.8rem",
            color: overtradingWarningColor,
            background: "rgba(13, 22, 36, 0.4)",
            padding: "8px 12px",
            borderRadius: "6px",
            marginTop: "12px",
            border: `1px solid ${overtradingBuckets.high.daysCount > 0 && overtradingBuckets.high.totalPnl / overtradingBuckets.high.daysCount < 0 ? "var(--red-border)" : "var(--border-color)"}`
          }}>
            {overtradingText}
          </div>
        </div>

        {/* Breakouts vs Range Trades */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Breakouts vs. Range Trades</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Performance breakdown of breakout setup classifications versus range setups.
          </p>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={setupChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                <YAxis stroke="var(--text-secondary)" fontSize={10} />
                <Tooltip formatter={(value, name) => [name === "pnl" ? `$${value}` : `${value}%`, name === "pnl" ? "Total P&L" : "Win Rate"]} />
                <Legend wrapperStyle={{ fontSize: "10px" }} />
                <Bar dataKey="pnl" name="Total P&L" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="winRate" name="Win Rate %" fill="var(--accent-gold)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "12px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            <div style={{ textAlign: "center", background: "rgba(13, 22, 36, 0.3)", padding: "4px", borderRadius: "4px" }}>
              Breakout count: <strong style={{ color: "var(--text-primary)" }}>{breakoutCount}</strong>
            </div>
            <div style={{ textAlign: "center", background: "rgba(13, 22, 36, 0.3)", padding: "4px", borderRadius: "4px" }}>
              Range count: <strong style={{ color: "var(--text-primary)" }}>{rangeCount}</strong>
            </div>
          </div>
        </div>

      </div>

      {/* 4. Bias & Reversal Performance Section */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
        
        {/* Performance by Market Bias */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Market Bias Performance</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
            P&L and Win Rate grouped by declared trade bias (Long, Short, Range).
          </p>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={biasChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                <YAxis stroke="var(--text-secondary)" fontSize={10} />
                <Tooltip formatter={(value, name) => [name === "pnl" ? `$${value}` : `${value}%`, name === "pnl" ? "Total P&L" : "Win Rate"]} />
                <Bar dataKey="pnl" name="Total P&L" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="winRate" name="Win Rate %" fill="var(--accent-green)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bias Reversals vs Aligned Bias */}
        <div className="glass-panel">
          <h3 style={{ marginBottom: "8px", fontSize: "1.1rem" }}>Bias Reversals vs. Aligned</h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Compares performance when bias was maintained vs when it flipped (reversal).
          </p>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={reversalChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--neutral-bg)" />
                <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                <YAxis stroke="var(--text-secondary)" fontSize={10} />
                <Tooltip formatter={(value, name) => [name === "pnl" ? `$${value}` : `${value}%`, name === "pnl" ? "Total P&L" : "Win Rate"]} />
                <Bar dataKey="pnl" name="Total P&L" fill="var(--accent-blue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="winRate" name="Win Rate %" fill="var(--accent-gold)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}

interface TooltipPayloadData {
  symbol: string;
  pnl: number;
  balance: number;
  winRate: number;
  profitFactor: number;
}

interface TooltipPayloadItem {
  payload: TooltipPayloadData;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="glass-panel" style={{ padding: "10px", border: "1px solid var(--accent-blue)", background: "var(--bg-secondary)" }}>
        <p style={{ fontWeight: "bold" }}>{label} ({data.symbol})</p>
        <p style={{ color: "var(--accent-blue)" }}>
          Trade P&L: <span className={data.pnl >= 0 ? "metric-positive" : "metric-negative"}>
            {data.pnl >= 0 ? "+" : ""}${data.pnl.toFixed(2)}
          </span>
        </p>
        <p style={{ color: "var(--text-primary)" }}>
          Account Balance: ${data.balance.toFixed(2)}
        </p>
        <p style={{ color: "var(--text-secondary)" }}>
          Rolling Win Rate: {data.winRate}%
        </p>
        <p style={{ color: "var(--text-secondary)" }}>
          Rolling PF: {data.profitFactor}
        </p>
      </div>
    );
  }
  return null;
};
