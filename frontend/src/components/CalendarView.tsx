import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Flame, X, MessageSquare, Download, Calendar, UploadCloud, Trash2 } from "lucide-react";
import type { Trade } from "./Dashboard";

interface CalendarViewProps {
  trades: Trade[];
  accountId: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const YEARS = [2024, 2025, 2026, 2027, 2028];

export default function CalendarView({ trades, accountId }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [allChats, setAllChats] = useState<any[]>([]);
  const [dayCharts, setDayCharts] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [activeLightboxImage, setActiveLightboxImage] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Fetch all chats for account in background to filter by date
  useEffect(() => {
    if (!accountId) return;
    fetch(`http://localhost:5000/api/ai/chats?accountId=${accountId}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAllChats(data);
        }
      })
      .catch((err) => console.error("Error fetching chats in calendar view:", err));
  }, [accountId]);

  // Fetch charts for the selected day
  const fetchDayCharts = (dayNum: number) => {
    if (!accountId) return;
    const dateStr = new Date(year, month, dayNum).toLocaleDateString();
    fetch(`http://localhost:5000/api/charts?accountId=${accountId}&dateStr=${encodeURIComponent(dateStr)}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setDayCharts(data);
        }
      })
      .catch((err) => console.error("Error fetching day charts:", err));
  };

  useEffect(() => {
    if (selectedDay) {
      fetchDayCharts(selectedDay);
    } else {
      setDayCharts([]);
    }
  }, [selectedDay, month, year, accountId]);

  // Aggregate P&L by Date string (MM/DD/YYYY)
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
    setSelectedDay(null);
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setSelectedDay(null);
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDay(null);
    const newMonth = parseInt(e.target.value);
    setCurrentDate(new Date(year, newMonth, 1));
  };

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDay(null);
    const newYear = parseInt(e.target.value);
    setCurrentDate(new Date(newYear, month, 1));
  };

  const handleGoToToday = () => {
    setSelectedDay(null);
    setCurrentDate(new Date());
  };

  const getDayDetails = (dayNum: number) => {
    const targetDate = new Date(year, month, dayNum);
    const dateKey = targetDate.toLocaleDateString();
    return dailyPnLs[dateKey] || null;
  };

  const getDayChats = (dayNum: number) => {
    const targetDateString = new Date(year, month, dayNum).toLocaleDateString();
    return allChats.filter((c) => new Date(c.created_at).toLocaleDateString() === targetDateString);
  };

  const handleDayClick = (dayNum: number) => {
    setSelectedDay(selectedDay === dayNum ? null : dayNum);
  };

  const handleChartUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedDay || !accountId) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async (event) => {
      const base64Data = event.target?.result as string;
      if (!base64Data) return;

      setIsUploading(true);
      const dateStr = new Date(year, month, selectedDay).toLocaleDateString();

      try {
        const res = await fetch("http://localhost:5000/api/charts/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            dateStr,
            imageData: base64Data,
          }),
        });

        if (res.ok) {
          fetchDayCharts(selectedDay);
        } else {
          const err = await res.json();
          alert(err.error || "Failed to upload chart screenshot");
        }
      } catch (err) {
        console.error("Upload error:", err);
        alert("Upload failed");
      } finally {
        setIsUploading(false);
      }
    };
  };

  const handleChartDelete = async (chartId: string) => {
    if (!window.confirm("Are you sure you want to delete this chart screenshot?")) return;
    try {
      const res = await fetch(`http://localhost:5000/api/charts/${chartId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (selectedDay) {
          fetchDayCharts(selectedDay);
        }
        if (activeLightboxImage) {
          setActiveLightboxImage(null);
        }
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete chart");
      }
    } catch (err) {
      console.error("Delete error:", err);
      alert("Delete failed");
    }
  };

  // Check if a day has a green/red color code
  const getDayStyles = (dayDetails: any, isSelected: boolean) => {
    let base = {
      background: "rgba(13, 22, 36, 0.4)",
      border: isSelected ? "2px solid var(--accent-blue)" : "1px solid var(--border-color)",
      color: "var(--text-secondary)",
      shadow: "none"
    };

    if (!dayDetails) return base;
    const pnl = dayDetails.pnl;
    
    if (pnl > 0.01) {
      base.background = "var(--green-bg-strong)";
      base.border = isSelected ? "2px solid var(--accent-blue)" : "1px solid var(--green-border)";
      base.color = "var(--accent-green)";
      base.shadow = "0 0 10px rgba(0, 230, 118, 0.1)";
    } else if (pnl < -0.01) {
      base.background = "var(--red-bg-strong)";
      base.border = isSelected ? "2px solid var(--accent-blue)" : "1px solid var(--red-border)";
      base.color = "var(--accent-red)";
      base.shadow = "0 0 10px rgba(255, 45, 85, 0.1)";
    } else {
      base.background = "var(--neutral-bg)";
      base.border = isSelected ? "2px solid var(--accent-blue)" : "1px solid var(--border-color)";
      base.color = "var(--text-primary)";
    }

    return base;
  };

  const handleExportDayReport = (dayNum: number, dayDetails: any, dayChats: any[]) => {
    const targetDateString = new Date(year, month, dayNum).toLocaleDateString();
    
    let report = `# Trading Performance Report: ${targetDateString}\n`;
    report += `Realized Net P&L: $${dayDetails.pnl.toFixed(2)}\n`;
    report += `Total Trades: ${dayDetails.trades.length}\n`;
    report += `==========================================\n\n`;
    
    report += `## TRADES LOG\n`;
    dayDetails.trades.forEach((t: any, idx: number) => {
      report += `Trade #${idx + 1}: ${t.symbol} (${t.status})\n`;
      report += `- Net Realized P&L: $${Number(t.net_pnl).toFixed(2)}\n`;
      report += `- R-Multiple: ${Number(t.r_multiple).toFixed(2)}R\n`;
      if (t.stop_loss) {
        report += `- Stop Loss: ${Number(t.stop_loss).toFixed(2)}\n`;
      }
      report += `- Bias: ${t.bias || "N/A"}\n`;
      report += `- Setup Type: ${t.trade_type || "N/A"}\n`;
      report += `- Rules Followed: ${t.rules_followed ? "Yes (Disciplined)" : "No (Breach)"}\n`;
      report += `- Notes: ${t.notes || "None"}\n`;
      if (t.executions && t.executions.length > 0) {
        report += `- Executions:\n`;
        t.executions.forEach((e: any) => {
          report += `  * ${e.side} ${Number(e.quantity)} lot @ ${Number(e.fill_price).toFixed(2)} (${new Date(e.execution_timestamp).toLocaleTimeString()})\n`;
        });
      }
      report += `\n`;
    });
    
    report += `==========================================\n\n`;
    report += `## AI COACH CONVERSATIONS\n`;
    if (dayChats.length === 0) {
      report += `No AI Coach conversations logged on this day.\n`;
    } else {
      dayChats.forEach((c: any) => {
        report += `[${new Date(c.created_at).toLocaleTimeString()}] ${c.role.toUpperCase()}:\n`;
        report += `${c.content}\n\n`;
      });
    }

    const dataStr = "data:text/markdown;charset=utf-8," + encodeURIComponent(report);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `trading_report_${targetDateString.replace(/\//g, "-")}.md`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const selectedDayDetails = selectedDay ? getDayDetails(selectedDay) : null;
  const selectedDayChats = selectedDay ? getDayChats(selectedDay) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Calendar Grid Container */}
      <div className="glass-panel">
        {/* Calendar Header Nav */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Calendar style={{ color: "var(--accent-blue)" }} size={20} />
            <h3 style={{ fontSize: "1.1rem", margin: 0 }}>
              Performance Calendar Grid
            </h3>
          </div>
          
          {/* Controls: Prev, Selector Dropdowns, Next, Today */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button className="btn-secondary" style={{ padding: "4px 8px" }} onClick={handlePrevMonth}>
              <ChevronLeft size={16} />
            </button>
            
            {/* Month Select */}
            <select
              className="input-field"
              style={{ width: "110px", padding: "4px 8px", fontSize: "0.8rem", margin: 0, height: "30px", minHeight: "30px" }}
              value={month}
              onChange={handleMonthChange}
            >
              {MONTHS.map((mName, idx) => (
                <option key={mName} value={idx}>{mName}</option>
              ))}
            </select>

            {/* Year Select */}
            <select
              className="input-field"
              style={{ width: "80px", padding: "4px 8px", fontSize: "0.8rem", margin: 0, height: "30px", minHeight: "30px" }}
              value={year}
              onChange={handleYearChange}
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            <button className="btn-secondary" style={{ padding: "4px 8px" }} onClick={handleNextMonth}>
              <ChevronRight size={16} />
            </button>

            <button
              className="btn-secondary"
              style={{ padding: "4px 10px", fontSize: "0.75rem", height: "30px", display: "flex", alignItems: "center" }}
              onClick={handleGoToToday}
            >
              Today
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
            const isSelected = selectedDay === day;
            const cellStyles = getDayStyles(dayDetails, isSelected);

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
                  borderColor: cellStyles.border.split(" ")[2],
                  borderWidth: cellStyles.border.split(" ")[0] === "2px" ? "2px" : "1px",
                  borderStyle: "solid",
                  boxShadow: cellStyles.shadow,
                  position: "relative",
                  transition: "transform 0.15s ease",
                  cursor: "pointer"
                }}
                onClick={() => handleDayClick(day)}
                title={dayDetails ? `${dayDetails.trades.length} trades taken. Click to view.` : "Click to view logs."}
              >
                {/* Day Number */}
                <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: cellStyles.color }}>{day}</span>

                {/* Day P&L content */}
                {dayDetails ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: "600", color: cellStyles.color }}>
                      {dayDetails.pnl >= 0 ? "+" : ""}${dayDetails.pnl.toFixed(0)}
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>
                      {dayDetails.trades.length} trade{dayDetails.trades.length > 1 ? "s" : ""}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)" }}>—</span>
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

      {/* Selected Day Details Panel */}
      {selectedDay && (
        <div className="glass-panel" style={{ padding: "20px", borderLeft: "4px solid var(--accent-blue)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "16px" }}>
            <div>
              <h4 style={{ fontSize: "1.1rem", margin: 0 }}>
                Logs & History: <span style={{ color: "var(--accent-blue)" }}>{MONTHS[month]} {selectedDay}, {year}</span>
              </h4>
            </div>
            
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {selectedDayDetails && (
                <button
                  className="btn-secondary"
                  style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "0.75rem" }}
                  onClick={() => handleExportDayReport(selectedDay, selectedDayDetails, selectedDayChats)}
                >
                  <Download size={14} />
                  Export Logs
                </button>
              )}
              <button
                style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
                onClick={() => setSelectedDay(null)}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "24px", minHeight: "200px" }}>
            {/* Left side: Trades Log */}
            <div>
              <h5 style={{ fontSize: "0.95rem", marginBottom: "12px", color: "var(--text-primary)" }}>Trades Realized</h5>
              {!selectedDayDetails || selectedDayDetails.trades.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>No trades logged on this day.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {selectedDayDetails.trades.map((t, idx) => {
                    const pnlNum = Number(t.net_pnl);
                    return (
                      <div
                        key={t.trade_id}
                        style={{
                          background: "rgba(13, 22, 36, 0.3)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "8px",
                          padding: "12px",
                          fontSize: "0.85rem"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                          <span style={{ fontWeight: "600", fontSize: "0.9rem" }}>
                            Trade #{idx + 1}: <span style={{ color: "var(--accent-blue)" }}>{t.symbol}</span>
                          </span>
                          <span style={{ fontWeight: "600", color: pnlNum >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                            {pnlNum >= 0 ? "+" : ""}${pnlNum.toFixed(2)} ({Number(t.r_multiple).toFixed(2)}R)
                          </span>
                        </div>
                        
                        <div style={{ display: "flex", gap: "10px", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "8px", flexWrap: "wrap" }}>
                          <span>Bias: <strong style={{ color: "var(--text-primary)" }}>{t.bias || "RANGE"}</strong></span>
                          <span>Setup: <strong style={{ color: "var(--text-primary)" }}>{t.trade_type || "BREAKOUT"}</strong></span>
                          <span>Discipline: <strong style={{ color: t.rules_followed ? "var(--accent-green)" : "var(--accent-red)" }}>{t.rules_followed ? "Followed" : "Breach"}</strong></span>
                          {t.stop_loss && (
                            <span>SL: <strong style={{ color: "var(--accent-gold)" }}>${Number(t.stop_loss).toFixed(2)}</strong></span>
                          )}
                        </div>

                        {t.notes && (
                          <div style={{ fontStyle: "italic", color: "var(--text-secondary)", background: "rgba(0, 0, 0, 0.15)", padding: "6px 8px", borderRadius: "4px", marginTop: "6px" }}>
                            "{t.notes}"
                          </div>
                        )}

                        {t.executions && t.executions.length > 0 && (
                          <div style={{ marginTop: "8px" }}>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "4px" }}>Execution Fills:</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {t.executions.map((e) => (
                                <div
                                  key={e.execution_id}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    fontSize: "0.75rem",
                                    padding: "2px 6px",
                                    background: "rgba(255, 255, 255, 0.02)",
                                    borderRadius: "3px"
                                  }}
                                >
                                  <span style={{ color: e.side === "BUY" ? "var(--accent-green)" : "var(--accent-gold)", fontWeight: "bold" }}>
                                    {e.side} {Number(e.quantity)} lot
                                  </span>
                                  <span>@{Number(e.fill_price).toFixed(2)}</span>
                                  <span style={{ color: "var(--text-secondary)" }}>
                                    {new Date(e.execution_timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right side: AI Coach Chats */}
            <div style={{ borderLeft: "1px solid var(--border-color)", paddingLeft: "24px" }}>
              <h5 style={{ fontSize: "0.95rem", marginBottom: "12px", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                <MessageSquare size={16} style={{ color: "var(--accent-blue)" }} />
                AI Coach Archive
              </h5>
              {selectedDayChats.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>No AI Coach chats recorded on this day.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "300px", overflowY: "auto", paddingRight: "6px" }}>
                  {selectedDayChats.map((c, idx) => (
                    <div
                      key={c.message_id || idx}
                      style={{
                        padding: "10px",
                        background: c.role === "user" ? "rgba(0, 229, 255, 0.05)" : "rgba(13, 22, 36, 0.4)",
                        border: `1px solid ${c.role === "user" ? "rgba(0, 229, 255, 0.2)" : "var(--border-color)"}`,
                        borderRadius: "8px",
                        fontSize: "0.8rem"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--text-secondary)", marginBottom: "4px" }}>
                        <span style={{ fontWeight: "bold", color: c.role === "user" ? "var(--accent-blue)" : "var(--accent-gold)" }}>
                          {c.role === "user" ? "User Query" : "Coach Response"}
                        </span>
                        <span>{new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <div style={{ whiteSpace: "pre-line", color: "var(--text-primary)" }}>
                        {c.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Charts Gallery Section (Cross-span at bottom) */}
          <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "20px", marginTop: "24px" }}>
            <h5 style={{ fontSize: "0.95rem", marginBottom: "12px", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <UploadCloud size={16} style={{ color: "var(--accent-gold)" }} />
              TradingView Screenshots Gallery
            </h5>
            
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
              {/* Thumbnails grid */}
              {dayCharts.map((c) => (
                <div
                  key={c.chart_id}
                  style={{
                    position: "relative",
                    width: "120px",
                    height: "80px",
                    borderRadius: "6px",
                    overflow: "hidden",
                    border: "1px solid var(--border-color)",
                    cursor: "pointer",
                    background: "rgba(0,0,0,0.2)",
                    transition: "transform 0.15s ease",
                  }}
                  onClick={() => setActiveLightboxImage(c.image_path)}
                  className="hover-card"
                >
                  <img
                    src={`http://localhost:5000${c.image_path}`}
                    alt="TradingView screenshot"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                  {/* Delete overlay button */}
                  <button
                    style={{
                      position: "absolute",
                      top: "4px",
                      right: "4px",
                      background: "rgba(255, 45, 85, 0.9)",
                      border: "none",
                      borderRadius: "50%",
                      width: "20px",
                      height: "20px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      cursor: "pointer",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.3)"
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleChartDelete(c.chart_id);
                    }}
                    title="Delete image"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {/* Upload screenshot card */}
              <label
                style={{
                  width: "120px",
                  height: "80px",
                  borderRadius: "6px",
                  border: "1.5px dashed var(--border-color)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: isUploading ? "not-allowed" : "pointer",
                  color: "var(--text-secondary)",
                  fontSize: "0.75rem",
                  gap: "4px",
                  background: "rgba(255,255,255,0.02)",
                  transition: "border-color 0.15s ease, background-color 0.15s ease",
                }}
                className="hover-card"
              >
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleChartUpload}
                  disabled={isUploading}
                />
                <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>+</span>
                <span>{isUploading ? "Uploading..." : "Upload Chart"}</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {activeLightboxImage && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.9)",
            backdropFilter: "blur(12px)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 10000,
            padding: "20px",
          }}
          onClick={() => setActiveLightboxImage(null)}
        >
          {/* Close button */}
          <button
            style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              background: "rgba(255,255,255,0.1)",
              border: "none",
              borderRadius: "50%",
              width: "40px",
              height: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            }}
            onClick={() => setActiveLightboxImage(null)}
          >
            <X size={24} />
          </button>

          {/* Full Screen Image */}
          <img
            src={`http://localhost:5000${activeLightboxImage}`}
            alt="TradingView Screenshot Full"
            style={{
              maxWidth: "95vw",
              maxHeight: "85vh",
              objectFit: "contain",
              borderRadius: "8px",
              boxShadow: "0 0 30px rgba(0,229,255,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          />
          
          <div style={{ marginTop: "16px", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            Click anywhere to close preview
          </div>
        </div>
      )}
    </div>
  );
}
