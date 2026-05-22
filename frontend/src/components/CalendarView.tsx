import { useState } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import type { Trade } from "./Dashboard";

interface CalendarViewProps {
  trades: Trade[];
}

export default function CalendarView({ trades }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Get name of current month
  const monthName = currentDate.toLocaleString("default", { month: "long" });

  // 1. Aggregate P&L by Date string (MM/DD/YYYY)
  const dailyPnLs: { [dateStr: string]: { pnl: number; trades: Trade[] } } = {};
  
  trades.forEach((t) => {
    if (t.status === "CLOSED") {
      const dateKey = new Date(t.created_at).toLocaleDateString();
      if (!dailyPnLs[dateKey]) {
        dailyPnLs[dateKey] = { pnl: 0, trades: [] };
      }
      dailyPnLs[dateKey].pnl += Number(t.net_pnl);
      dailyPnLs[dateKey].trades.push(t);
    }
  });

  // Calculate calendar parameters
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // Day of week (0 = Sunday)
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Create array of days to render in grid
  const daysArray: (number | null)[] = [];
  
  // Padding for starting offset
  for (let i = 0; i < firstDayOfMonth; i++) {
    daysArray.push(null);
  }
  
  // Add days of month
  for (let i = 1; i <= daysInMonth; i++) {
    daysArray.push(i);
  }

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const getDayDetails = (dayNum: number) => {
    const targetDate = new Date(year, month, dayNum);
    const dateKey = targetDate.toLocaleDateString();
    return dailyPnLs[dateKey] || null;
  };

  // Check if a day has a green/red color code
  const getDayStyles = (dayDetails: any) => {
    if (!dayDetails) return { background: "rgba(13, 22, 36, 0.4)", color: "var(--text-secondary)" };
    const pnl = dayDetails.pnl;
    if (pnl > 0.01) {
      return {
        background: "rgba(0, 230, 118, 0.12)",
        border: "1px solid rgba(0, 230, 118, 0.3)",
        color: "var(--accent-green)",
      };
    } else if (pnl < -0.01) {
      return {
        background: "rgba(255, 45, 85, 0.12)",
        border: "1px solid rgba(255, 45, 85, 0.3)",
        color: "var(--accent-red)",
      };
    }
    return { background: "rgba(74, 120, 152, 0.08)", color: "var(--text-primary)" };
  };

  return (
    <div className="glass-panel">
      {/* Calendar Header Nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h3>
          Monthly Performance Grid: <span style={{ color: "var(--accent-blue)" }}>{monthName} {year}</span>
        </h3>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn-secondary" style={{ padding: "4px 8px" }} onClick={handlePrevMonth}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn-secondary" style={{ padding: "4px 8px" }} onClick={handleNextMonth}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Weekday Labels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px", textAlign: "center", marginBottom: "8px", fontWeight: "600", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      {/* Calendar Grid Cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "8px" }}>
        {daysArray.map((day, idx) => {
          if (day === null) {
            return (
              <div 
                key={`empty-${idx}`} 
                style={{ height: "90px", background: "transparent", border: "1px solid transparent" }}
              />
            );
          }

          const dayDetails = getDayDetails(day);
          const cellStyles = getDayStyles(dayDetails);

          return (
            <div
              key={`day-${day}`}
              className="glass-panel"
              style={{
                height: "90px",
                padding: "8px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                background: cellStyles.background,
                borderColor: cellStyles.border ? cellStyles.border.split(" ")[2] : "var(--border-color)",
                borderWidth: "1px",
                borderStyle: "solid",
                position: "relative",
                transition: "transform 0.15s ease",
                cursor: dayDetails ? "pointer" : "default"
              }}
              title={dayDetails ? `${dayDetails.trades.length} trades taken on this day` : ""}
            >
              {/* Day Number */}
              <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: cellStyles.color }}>{day}</span>

              {/* Day P&L content */}
              {dayDetails && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: "600", color: cellStyles.color }}>
                    {dayDetails.pnl >= 0 ? "+" : ""}${dayDetails.pnl.toFixed(0)}
                  </span>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>
                    {dayDetails.trades.length} trades
                  </span>
                </div>
              )}

              {/* Glowing highlight for winning streaks */}
              {dayDetails && dayDetails.pnl > 100 && (
                <div style={{ position: "absolute", bottom: "4px", left: "6px", color: "var(--accent-gold)" }}>
                  <Flame size={12} style={{ fill: "var(--accent-gold)" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Legend key */}
      <div style={{ display: "flex", gap: "16px", marginTop: "20px", fontSize: "0.8rem", color: "var(--text-secondary)", justifyContent: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "12px", height: "12px", background: "rgba(0, 230, 118, 0.15)", border: "1px solid rgba(0, 230, 118, 0.4)", borderRadius: "2px" }} />
          <span>Profit Day</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "12px", height: "12px", background: "rgba(255, 45, 85, 0.15)", border: "1px solid rgba(255, 45, 85, 0.4)", borderRadius: "2px" }} />
          <span>Loss Day</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "12px", height: "12px", background: "rgba(13, 22, 36, 0.4)", border: "1px solid var(--border-color)", borderRadius: "2px" }} />
          <span>No Trades</span>
        </div>
      </div>
    </div>
  );
}
