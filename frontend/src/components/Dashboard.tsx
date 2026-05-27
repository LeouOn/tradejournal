import React, { useState, useEffect } from "react";
import { 
  Award, Flame, EyeOff, Eye, Plus, Trash2, Play, MessageSquare
} from "lucide-react";
import { useToast } from "../contexts/ToastContext";
import AICoach from "./AICoach";

interface Tag {
  tag_id: string;
  tag_category: string;
  tag_name: string;
  color_code: string;
}

interface Execution {
  execution_id: string;
  fill_price: number | string;
  quantity: number | string;
  side: string;
  execution_timestamp: string;
}

interface MarketContext {
  regime_type: string;
  vix_level: number | string;
  fed_funds_rate: number | string;
  spx_trend: string;
}

export interface Trade {
  trade_id: string;
  symbol: string;
  status: string;
  net_pnl: number | string;
  r_multiple: number | string;
  duration: number;
  rules_followed: boolean;
  notes?: string;
  executions: Execution[];
  trade_tags: { tag: Tag }[];
  market_context: MarketContext[];
  created_at: string;
  bias?: string;
  bias_reversal?: boolean;
  trade_type?: string;
  stop_loss?: number | string | null;
}

export interface Stats {
  winRate: number;
  profitFactor: number;
  expectancyNominal: number;
  expectancyR: number;
  maxDrawdown: number;
  zellaScore: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  ruleAdherenceRate: number;
  costOfIndiscipline: number;
  grossProfits?: number;
  grossLosses?: number;
}

interface DashboardProps {
  accountId: string;
  trades: Trade[];
  stats: Stats;
  initialBalance: number;
  onRefresh: () => void;
  onSelectTradeForReplay: (trade: Trade) => void;
  onSetActiveTab: (tab: string) => void;
}

export default function Dashboard({
  accountId,
  trades,
  stats,
  initialBalance,
  onRefresh,
  onSelectTradeForReplay,
  onSetActiveTab
}: DashboardProps) {
  const toast = useToast();

  // Helper to calculate remaining contracts
  const getRemainingQuantity = (executions: Execution[]): number => {
    if (!executions || executions.length === 0) return 0;
    const direction = executions[0].side; // BUY or SELL
    let entryQty = 0;
    let exitQty = 0;
    executions.forEach((e) => {
      const qty = Number(e.quantity) || 0;
      if (e.side === direction) {
        entryQty += qty;
      } else {
        exitQty += qty;
      }
    });
    return Math.max(0, entryQty - exitQty);
  };

  // UI Display Toggles
  const [displayUnit, setDisplayUnit] = useState<"USD" | "PCT" | "R" | "POINTS" | "TICKS">("USD");
  const [privacyMode, setPrivacyMode] = useState(false);

  // Manual Logger Form State
  const [isLoggingOpen, setIsLoggingOpen] = useState(false);
  const [isAILoggingOpen, setIsAILoggingOpen] = useState(true);
  const [entryMode, setEntryMode] = useState<"quick" | "advanced">("quick");
  const [symbol, setSymbol] = useState("");
  const [initialRisk, setInitialRisk] = useState("100");
  const [stopLoss, setStopLoss] = useState("");
  const [tradeTimestamp, setTradeTimestamp] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16); // Local format YYYY-MM-DDTHH:MM
  });
  const [rulesFollowed, setRulesFollowed] = useState(true);
  const [notes, setNotes] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [isClosed, setIsClosed] = useState(true);
  const [customTagName, setCustomTagName] = useState("");

  const [bias, setBias] = useState<"LONG" | "SHORT" | "RANGE">("RANGE");
  const [biasReversal, setBiasReversal] = useState(false);
  const [tradeType, setTradeType] = useState<"BREAKOUT" | "RANGE">("BREAKOUT");

  // Edit Trade Modal State
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [editSymbol, setEditSymbol] = useState("");
  const [editStopLoss, setEditStopLoss] = useState("");
  const [editBias, setEditBias] = useState<"LONG" | "SHORT" | "RANGE">("RANGE");
  const [editBiasReversal, setEditBiasReversal] = useState(false);
  const [editTradeType, setEditTradeType] = useState<"BREAKOUT" | "RANGE">("BREAKOUT");
  const [editStatus, setEditStatus] = useState("CLOSED");
  const [editRulesFollowed, setEditRulesFollowed] = useState(true);
  const [editNotes, setEditNotes] = useState("");
  const [editExecutions, setEditExecutions] = useState<Execution[]>([]);
  const [newExecPrice, setNewExecPrice] = useState("");
  const [newExecQty, setNewExecQty] = useState("1");
  const [newExecSide, setNewExecSide] = useState<"BUY" | "SELL">("BUY");

  // Risk Management boundaries
  const [profitTarget, setProfitTarget] = useState(() => {
    return localStorage.getItem("daily_profit_target") || "500";
  });
  const [maxLoss, setMaxLoss] = useState(() => {
    return localStorage.getItem("daily_max_loss") || "300";
  });

  useEffect(() => {
    localStorage.setItem("daily_profit_target", profitTarget);
  }, [profitTarget]);

  useEffect(() => {
    localStorage.setItem("daily_max_loss", maxLoss);
  }, [maxLoss]);

  // Quick Mode States
  const [quickSide, setQuickSide] = useState<"BUY" | "SELL">("BUY");
  const [quickEntryPrice, setQuickEntryPrice] = useState("");
  const [quickExitPrice, setQuickExitPrice] = useState("");
  const [quickQuantity, setQuickQuantity] = useState("1");

  // Execution List Sub-form (Advanced Mode)
  const [executionsInput, setExecutionsInput] = useState<{
    fill_price: string;
    quantity: string;
    side: "BUY" | "SELL";
  }[]>([{ fill_price: "", quantity: "1", side: "BUY" }]);

  // Fetch tags for manual selection
  useEffect(() => {
    fetch("http://localhost:5000/api/tags")
      .then((res) => res.json())
      .then((data) => setAvailableTags(data))
      .catch((e) => console.error("Error loading tags:", e));
  }, []);

  const handleCreateCustomTag = async () => {
    if (!customTagName || !customTagName.trim()) return;
    const tagName = customTagName.trim();
    if (availableTags.some(t => t.tag_name.toLowerCase() === tagName.toLowerCase())) {
      alert("Tag already exists");
      return;
    }
    try {
      const res = await fetch("http://localhost:5000/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag_name: tagName,
          tag_category: "Setup",
          color_code: "#a020f0"
        })
      });
      if (res.ok) {
        const newTag = await res.json();
        setAvailableTags([...availableTags, newTag]);
        setSelectedTags([...selectedTags, newTag.tag_name]);
        setCustomTagName("");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create tag");
      }
    } catch (e) {
      console.error(e);
      alert("Error creating tag");
    }
  };

  const handleExportData = () => {
    fetch("http://localhost:5000/api/trades/export")
      .then((res) => res.json())
      .then((data) => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `trades_export_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      })
      .catch((e) => {
        console.error(e);
        alert("Export failed");
      });
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    const files = e.target.files;
    if (!files || files.length === 0) return;
    fileReader.readAsText(files[0], "UTF-8");
    fileReader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const res = await fetch("http://localhost:5000/api/trades/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trades: parsed, accountId }),
        });
        if (res.ok) {
          const result = await res.json();
          alert(`Successfully imported ${result.count} trades!`);
          onRefresh();
        } else {
          const err = await res.json();
          alert(err.error || "Import failed");
        }
      } catch {
        alert("Invalid file format. Make sure it is a valid trades JSON file.");
      }
    };
  };

  const handleEditExecution = async (execId: string, updatedFields: Partial<Execution>) => {
    if (updatedFields.fill_price !== undefined) {
      const p = parseFloat(String(updatedFields.fill_price));
      if (isNaN(p) || p <= 0) {
        alert("Price must be greater than zero");
        return;
      }
    }
    if (updatedFields.quantity !== undefined) {
      const q = parseFloat(String(updatedFields.quantity));
      if (isNaN(q) || q <= 0) {
        alert("Quantity must be greater than zero");
        return;
      }
    }
    try {
      const res = await fetch(`http://localhost:5000/api/executions/${execId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedFields),
      });
      if (res.ok) {
        setEditExecutions(editExecutions.map(e => e.execution_id === execId ? { ...e, ...updatedFields } : e));
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update execution");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteExecution = async (execId: string) => {
    if (!window.confirm("Are you sure you want to delete this execution?")) return;
    try {
      const res = await fetch(`http://localhost:5000/api/executions/${execId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setEditExecutions(editExecutions.filter(e => e.execution_id !== execId));
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete execution");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddExecutionToEditTrade = async () => {
    if (!newExecPrice || !newExecQty) return alert("Fill price and Quantity are required");
    const p = parseFloat(newExecPrice);
    const q = parseFloat(newExecQty);
    if (isNaN(p) || p <= 0 || isNaN(q) || q <= 0) {
      return alert("Price and Quantity must be greater than zero");
    }
    try {
      const res = await fetch("http://localhost:5000/api/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade_id: editingTrade?.trade_id,
          fill_price: newExecPrice,
          quantity: newExecQty,
          side: newExecSide,
          initial_risk: initialRisk,
        }),
      });
      if (res.ok) {
        const newExec = await res.json();
        setEditExecutions([...editExecutions, newExec]);
        setNewExecPrice("");
        setNewExecQty("1");
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to add execution");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveEditedTrade = async () => {
    if (!editingTrade) return;
    try {
      const res = await fetch(`http://localhost:5000/api/trades/${editingTrade.trade_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: editSymbol.toUpperCase(),
          bias: editBias,
          bias_reversal: editBiasReversal,
          trade_type: editTradeType,
          status: editStatus,
          rules_followed: editRulesFollowed,
          notes: editNotes,
          initial_risk: initialRisk,
          stop_loss: editStopLoss ? Number(editStopLoss) : null,
        }),
      });
      if (res.ok) {
        setEditingTrade(null);
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update trade");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteTrade = async (tradeId: string) => {
    if (!window.confirm("Are you sure you want to delete this entire trade? This cannot be undone.")) return;
    try {
      const res = await fetch(`http://localhost:5000/api/trades/${tradeId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setEditingTrade(null);
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to delete trade");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleTradeStatus = async (tradeId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "CLOSED" ? "OPEN" : "CLOSED";
    try {
      const res = await fetch(`http://localhost:5000/api/trades/${tradeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          manual_status: true
        })
      });
      if (res.ok) {
        onRefresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to toggle status");
      }
    } catch (e) {
      console.error(e);
      alert("Error toggling trade status");
    }
  };

  const handleAddExecutionRow = () => {
    const lastSide = executionsInput[executionsInput.length - 1]?.side || "BUY";
    setExecutionsInput([...executionsInput, { fill_price: "", quantity: "1", side: lastSide }]);
  };

  const handleRemoveExecutionRow = (index: number) => {
    if (executionsInput.length === 1) return;
    setExecutionsInput(executionsInput.filter((_, i) => i !== index));
  };

  const handleExecutionChange = (index: number, field: "fill_price" | "quantity" | "side", value: string) => {
    const updated = [...executionsInput];
    if (field === "side") {
      updated[index].side = value as "BUY" | "SELL";
    } else if (field === "fill_price") {
      updated[index].fill_price = value;
    } else if (field === "quantity") {
      updated[index].quantity = value;
    }
    setExecutionsInput(updated);
  };

  const toggleTag = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagName));
    } else {
      setSelectedTags([...selectedTags, tagName]);
    }
  };

  const handleSaveTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !accountId) return alert("Symbol and Account are required");

    // Client-side sanity checks for entry/exit price proximity
    if (entryMode === "quick" && quickExitPrice) {
      const entryNum = parseFloat(quickEntryPrice);
      const exitNum = parseFloat(quickExitPrice);
      if (entryNum > 0 && exitNum > 0) {
        const delta = Math.abs(entryNum - exitNum) / entryNum;
        if (delta > 0.30) {
          const confirmSave = window.confirm(
            `WARNING: The exit price (${exitNum}) is over 30% away from the entry price (${entryNum}). This may be a typo. Are you sure you want to save this trade?`
          );
          if (!confirmSave) return;
        }
      }
    } else if (entryMode === "advanced" && executionsInput.length > 1) {
      const firstPrice = parseFloat(executionsInput[0].fill_price);
      if (firstPrice > 0) {
        for (let i = 1; i < executionsInput.length; i++) {
          const nextPrice = parseFloat(executionsInput[i].fill_price);
          if (nextPrice > 0) {
            const delta = Math.abs(firstPrice - nextPrice) / firstPrice;
            if (delta > 0.30) {
              const confirmSave = window.confirm(
                `WARNING: Execution price #${i + 1} (${nextPrice}) is over 30% away from the first execution price (${firstPrice}). This may be a typo. Are you sure you want to save this trade?`
              );
              if (!confirmSave) return;
            }
          }
        }
      }
    }

    try {
      // 1. Create Trade record with tags
      const tradeRes = await fetch("http://localhost:5000/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          account_id: accountId,
          rules_followed: rulesFollowed,
          notes: notes,
          tags: selectedTags,
          status: isClosed ? "CLOSED" : "OPEN",
          manual_status: true,
          bias: bias,
          bias_reversal: biasReversal,
          trade_type: tradeType,
          created_at: tradeTimestamp ? new Date(tradeTimestamp).toISOString() : undefined,
          stop_loss: stopLoss ? Number(stopLoss) : null,
        }),
      });
      const newTrade = await tradeRes.json();
      const tradeId = newTrade.trade_id;

      const execTimestamp = tradeTimestamp ? new Date(tradeTimestamp).toISOString() : undefined;

      // 2. Add executions based on mode
      if (entryMode === "quick") {
        if (!quickEntryPrice) {
          alert("Entry Price is required in Quick Mode");
          return;
        }
        // Log Entry Execution
        await fetch("http://localhost:5000/api/executions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trade_id: tradeId,
            fill_price: quickEntryPrice,
            quantity: quickQuantity,
            side: quickSide,
            initial_risk: initialRisk,
            execution_timestamp: execTimestamp,
          }),
        });

        // Log Exit Execution if provided
        if (quickExitPrice) {
          const exitSide = quickSide === "BUY" ? "SELL" : "BUY";
          await fetch("http://localhost:5000/api/executions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trade_id: tradeId,
              fill_price: quickExitPrice,
              quantity: quickQuantity,
              side: exitSide,
              initial_risk: initialRisk,
              execution_timestamp: execTimestamp,
            }),
          });
        }
      } else {
        // Advanced mode: Add all entered executions sequentially
        for (const exec of executionsInput) {
          if (!exec.fill_price || !exec.quantity) continue;
          await fetch("http://localhost:5000/api/executions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trade_id: tradeId,
              fill_price: exec.fill_price,
              quantity: exec.quantity,
              side: exec.side,
              initial_risk: initialRisk,
              execution_timestamp: execTimestamp,
            }),
          });
        }
      }

      // Reset Form fields, keeping logger open
      setSymbol("");
      setNotes("");
      setSelectedTags([]);
      setExecutionsInput([{ fill_price: "", quantity: "1", side: "BUY" }]);
      setQuickEntryPrice("");
      setQuickExitPrice("");
      setQuickQuantity("1");
      setIsClosed(true);
      setBias("RANGE");
      setBiasReversal(false);
      setTradeType("BREAKOUT");
      setStopLoss("");
      setTradeTimestamp(() => {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        return now.toISOString().slice(0, 16);
      });
      onRefresh();

      if (rulesFollowed) {
        toast.celebrate("Elite discipline! Consistency builds professional edge. Keep it up! 🏆", "Disciplined Trade Logged!");
      } else {
        toast.nudge("Self-reporting mistakes takes courage and builds edge. Recording errors is how we grow! 🧠", "Mistake Logged & Respected");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to save the trade. Please review fields.");
    }
  };

  // Simulate WebSocket Live Trade execution
  const handleSimulateTrade = async () => {
    const mockSymbols = ["ES", "NQ", "RTY", "YM"];
    const randSymbol = mockSymbols[Math.floor(Math.random() * mockSymbols.length)];
    const isLong = Math.random() > 0.4;
    const isWinning = Math.random() > 0.45;
    
    // Futures index base price
    const entryPrice = randSymbol === "NQ" ? 18000 + Math.random() * 200 : 5100 + Math.random() * 50;
    // const tickSize = randSymbol === "NQ" ? 0.25 : 0.25;
    // const tickVal = randSymbol === "NQ" ? 5 : 12.5; // per contract per point
    const pointsDelta = isWinning ? (10 + Math.random() * 30) : -(5 + Math.random() * 15);
    const exitPrice = entryPrice + (isLong ? pointsDelta : -pointsDelta);

    try {
      // Create Trade
      const tradeRes = await fetch("http://localhost:5000/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: randSymbol,
          account_id: accountId,
          rules_followed: Math.random() > 0.15,
          notes: `Simulated live execution. Set up: ${isLong ? "Long Breakout" : "Short Mean Reversion"}`,
          tags: isLong ? ["Breakout", "VWAP Bounce"] : ["Mean Reversion"],
        }),
      });
      const newTrade = await tradeRes.json();
      const tradeId = newTrade.trade_id;

      // Log Entry Fill
      await fetch("http://localhost:5000/api/executions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade_id: tradeId,
          fill_price: entryPrice.toFixed(2),
          quantity: 2,
          side: isLong ? "BUY" : "SELL",
          initial_risk: "200",
        }),
      });

      // Timeout simulation for exit fill (500ms)
      setTimeout(async () => {
        await fetch("http://localhost:5000/api/executions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trade_id: tradeId,
            fill_price: exitPrice.toFixed(2),
            quantity: 2,
            side: isLong ? "SELL" : "BUY",
            initial_risk: "200",
          }),
        });
        onRefresh();
      }, 500);

    } catch (err) {
      console.error("Simulation failed:", err);
    }
  };

  const getSymbolMultiplier = (sym: string): number => {
    const clean = sym.toUpperCase().trim();
    if (clean.startsWith("MNQ")) return 2;
    if (clean.startsWith("NQ")) return 20;
    if (clean.startsWith("MES")) return 5;
    if (clean.startsWith("ES")) return 50;
    if (clean.startsWith("M2K")) return 5;
    if (clean.startsWith("RTY")) return 50;
    if (clean.startsWith("MYM")) return 0.5;
    if (clean.startsWith("YM")) return 5;
    if (clean.startsWith("MCL")) return 100;
    if (clean.startsWith("CL")) return 1000;
    if (clean.startsWith("MGC")) return 10;
    if (clean.startsWith("GC")) return 100;
    if (clean.startsWith("NG")) return 10000;
    return 1; // default multiplier
  };

  const getSymbolTickValue = (sym: string): number => {
    const clean = sym.toUpperCase().trim();
    const multiplier = getSymbolMultiplier(clean);
    let tickSize = 0.25;
    if (clean.startsWith("YM") || clean.startsWith("MYM")) tickSize = 1.0;
    else if (clean.startsWith("RTY") || clean.startsWith("M2K")) tickSize = 0.1;
    else if (clean.startsWith("CL") || clean.startsWith("MCL")) tickSize = 0.01;
    else if (clean.startsWith("GC") || clean.startsWith("MGC")) tickSize = 0.1;
    else if (clean.startsWith("NG")) tickSize = 0.001;
    return multiplier * tickSize;
  };

  // Metric Formatter Helper
  const formatMetric = (val: number, isPnl = false, tradeSymbol?: string) => {
    if (privacyMode && isPnl) return "$***.**";
    if (displayUnit === "R") {
      const rVal = isPnl ? val / Number(initialRisk || 100) : val;
      return `${rVal >= 0 ? "+" : ""}${rVal.toFixed(2)}R`;
    }
    if (displayUnit === "PCT") {
      const pct = (val / initialBalance) * 100;
      return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
    }
    if (displayUnit === "POINTS") {
      const mult = tradeSymbol ? getSymbolMultiplier(tradeSymbol) : 50;
      const pts = val / mult;
      return `${pts >= 0 ? "+" : ""}${pts.toFixed(1)} pts`;
    }
    if (displayUnit === "TICKS") {
      const tickVal = tradeSymbol ? getSymbolTickValue(tradeSymbol) : 12.5;
      const ticks = val / tickVal;
      return `${ticks >= 0 ? "+" : ""}${ticks.toFixed(0)} ticks`;
    }
    // Default USD
    return `${val < 0 ? "-" : ""}$${Math.abs(val).toFixed(2)}`;
  };

  const getPnlClass = (val: number | string) => {
    const num = Number(val);
    return num > 0.01 ? "metric-positive" : num < -0.01 ? "metric-negative" : "metric-neutral";
  };

  // Streak calculation (closed daily returns)
  const calculateStreak = () => {
    let streak = 0;
    const dayPnls: { [date: string]: number } = {};
    
    trades.forEach((t) => {
      if (t.status === "CLOSED") {
        const d = new Date(t.created_at).toLocaleDateString();
        dayPnls[d] = (dayPnls[d] || 0) + Number(t.net_pnl);
      }
    });

    const sortedDates = Object.keys(dayPnls).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    for (const d of sortedDates) {
      if (dayPnls[d] > 0.01) {
        streak++;
      } else if (dayPnls[d] < -0.01) {
        break; // streak broken
      }
    }
    return streak;
  };

  const activeStreak = calculateStreak();

  return (
    <div>
      {/* Dynamic Toggles and Action Row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
        {/* Toggle units */}
        <div className="glass-panel" style={{ padding: "6px 12px", display: "flex", gap: "8px", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginRight: "8px" }}>Unit:</span>
          {(["USD", "PCT", "R", "POINTS", "TICKS"] as const).map((unit) => (
            <button
              key={unit}
              className={`btn-secondary`}
              style={{
                padding: "4px 8px",
                fontSize: "0.75rem",
                border: displayUnit === unit ? "1px solid var(--accent-blue)" : "1px solid transparent",
                backgroundColor: displayUnit === unit ? "var(--accent-bg-strong)" : "transparent"
              }}
              onClick={() => setDisplayUnit(unit)}
            >
              {unit}
            </button>
          ))}
        </div>

        {/* Action button triggers */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button 
            className="btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            onClick={() => setPrivacyMode(!privacyMode)}
          >
            {privacyMode ? <Eye size={16} /> : <EyeOff size={16} />}
            {privacyMode ? "Reveal Metrics" : "Privacy Mode"}
          </button>
          <button 
            className="btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            onClick={handleExportData}
          >
            Export JSON
          </button>
          <label 
            className="btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
          >
            Import JSON
            <input 
              type="file" 
              accept=".json" 
              onChange={handleImportData} 
              style={{ display: "none" }} 
            />
          </label>
          <button 
            className="btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--accent-blue)", borderColor: "var(--border-hover)" }}
            onClick={handleSimulateTrade}
          >
            <Play size={16} />
            Simulate Live Trade
          </button>
          <button 
            className="btn-primary" 
            style={{ display: "flex", alignItems: "center", gap: "6px", backgroundColor: isAILoggingOpen ? "var(--accent-blue)" : "var(--bg-secondary)", color: isAILoggingOpen ? "#fff" : "var(--text-primary)" }}
            onClick={() => { setIsAILoggingOpen(!isAILoggingOpen); setIsLoggingOpen(false); }}
          >
            <MessageSquare size={18} />
            Log via AI
          </button>
          <button 
            className="btn-primary" 
            style={{ display: "flex", alignItems: "center", gap: "6px", backgroundColor: isLoggingOpen ? "var(--accent-blue)" : "var(--bg-secondary)", color: isLoggingOpen ? "#fff" : "var(--text-primary)" }}
            onClick={() => { setIsLoggingOpen(!isLoggingOpen); setIsAILoggingOpen(false); }}
          >
            <Plus size={18} />
            Manual Entry
          </button>
        </div>
      </div>

      {/* Daily Performance Alert Banners */}
      {(() => {
        const todayStr = new Date().toLocaleDateString();
        const todayClosedTrades = trades.filter(t => t.status === "CLOSED" && new Date(t.created_at).toLocaleDateString() === todayStr);
        const todayPnl = todayClosedTrades.reduce((acc, t) => acc + Number(t.net_pnl), 0);
        return (
          <>
            {todayPnl >= Number(profitTarget) && Number(profitTarget) > 0 && (
              <div className="glass-panel glow-effect" style={{ marginBottom: "20px", border: "1px solid var(--accent-green)", background: "var(--green-bg)", padding: "12px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Flame size={20} style={{ color: "var(--accent-green)" }} />
                  <div>
                    <strong style={{ color: "var(--accent-green)" }}>Daily Profit Target Reached!</strong>
                    <span style={{ marginLeft: "8px", fontSize: "0.9rem" }}>
                      You made <span style={{ fontWeight: "bold" }}>{formatMetric(todayPnl, true)}</span> today, exceeding your profit target of {formatMetric(Number(profitTarget))}. Lock in your gains!
                    </span>
                  </div>
                </div>
              </div>
            )}
            {todayPnl <= -Number(maxLoss) && Number(maxLoss) > 0 && (
              <div className="glass-panel glow-effect" style={{ marginBottom: "20px", border: "1px solid var(--accent-red)", background: "var(--red-bg)", padding: "12px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <EyeOff size={20} style={{ color: "var(--accent-red)" }} />
                  <div>
                    <strong style={{ color: "var(--accent-red)" }}>Daily Max Loss Limit Breached!</strong>
                    <span style={{ marginLeft: "8px", fontSize: "0.9rem" }}>
                      Daily loss is <span style={{ fontWeight: "bold" }}>{formatMetric(todayPnl, true)}</span>, exceeding your risk limit of {formatMetric(Number(maxLoss))}. Stop trading to protect capital.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* AI Logger Panel */}
      {isAILoggingOpen && (
        <div style={{ marginBottom: "24px", border: "1px solid var(--border-color)", borderRadius: "12px", overflow: "hidden" }}>
          <AICoach accountId={accountId} onRefreshTrades={onRefresh} compact={true} />
        </div>
      )}

      {/* Manual Logger Sliding/Toggled Panel */}
      {isLoggingOpen && (
        <div className="glass-panel glow-effect" style={{ marginBottom: "24px", borderLeft: "4px solid var(--accent-blue)" }}>
          <h3 style={{ marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Manual Trade Logger</span>
            <button 
              type="button" 
              className="btn-secondary" 
              style={{ padding: "4px 8px", fontSize: "0.75rem" }}
              onClick={() => {
                // Clear fields
                setSymbol("");
                setNotes("");
                setSelectedTags([]);
                setQuickEntryPrice("");
                setQuickExitPrice("");
                setQuickQuantity("1");
              }}
            >
              Clear Fields
            </button>
          </h3>

          {/* Mode Tab Selectors */}
          <div style={{ display: "flex", gap: "12px", borderBottom: "1px solid var(--border-color)", paddingBottom: "12px", marginBottom: "16px" }}>
            <button
              type="button"
              className="btn-secondary"
              style={{
                borderColor: entryMode === "quick" ? "var(--accent-blue)" : "transparent",
                background: entryMode === "quick" ? "var(--accent-bg)" : "transparent",
                padding: "6px 12px",
                fontSize: "0.8rem",
                color: entryMode === "quick" ? "var(--accent-blue)" : "var(--text-secondary)"
              }}
              onClick={() => setEntryMode("quick")}
            >
              Quick Trade Mode
            </button>
            <button
              type="button"
              className="btn-secondary"
              style={{
                borderColor: entryMode === "advanced" ? "var(--accent-blue)" : "transparent",
                background: entryMode === "advanced" ? "var(--accent-bg)" : "transparent",
                padding: "6px 12px",
                fontSize: "0.8rem",
                color: entryMode === "advanced" ? "var(--accent-blue)" : "var(--text-secondary)"
              }}
              onClick={() => setEntryMode("advanced")}
            >
              Advanced Multi-Scale Mode
            </button>
          </div>

          <form onSubmit={handleSaveTrade}>
            {/* Common Header Info */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "16px", marginBottom: "20px" }}>
              <div>
                <label className="label-text">Symbol / Ticker</label>
                <input
                  type="text"
                  placeholder="e.g. ES"
                  className="input-field"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label-text">Initial Risk per trade (1R)</label>
                <input
                  type="number"
                  placeholder="100"
                  className="input-field"
                  value={initialRisk}
                  onChange={(e) => setInitialRisk(e.target.value)}
                />
              </div>
              <div>
                <label className="label-text">Stop Loss (Optional)</label>
                <input
                  type="number"
                  step="any"
                  placeholder="Stop price"
                  className="input-field"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                />
              </div>
              <div>
                <label className="label-text">Trade Date & Time</label>
                <input
                  type="datetime-local"
                  className="input-field"
                  value={tradeTimestamp}
                  onChange={(e) => setTradeTimestamp(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label-text">Rules Followed?</label>
                <select 
                  className="input-field"
                  value={rulesFollowed ? "yes" : "no"}
                  onChange={(e) => setRulesFollowed(e.target.value === "yes")}
                >
                  <option value="yes">YES - Disciplined</option>
                  <option value="no">NO - Breached</option>
                </select>
              </div>
              <div>
                <label className="label-text">Market Bias</label>
                <select 
                  className="input-field"
                  value={bias}
                  onChange={(e) => setBias(e.target.value as "LONG" | "SHORT" | "RANGE")}
                >
                  <option value="LONG">Long</option>
                  <option value="SHORT">Short</option>
                  <option value="RANGE">Range</option>
                </select>
              </div>
              <div>
                <label className="label-text">Setup Type</label>
                <select 
                  className="input-field"
                  value={tradeType}
                  onChange={(e) => setTradeType(e.target.value as "BREAKOUT" | "RANGE")}
                >
                  <option value="BREAKOUT">Breakout</option>
                  <option value="RANGE">Range Trade</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", marginBottom: "20px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isClosed}
                  onChange={(e) => setIsClosed(e.target.checked)}
                  style={{ width: "16px", height: "16px", accentColor: "var(--accent-blue)" }}
                />
                <span className="label-text" style={{ margin: 0 }}>Trade Closed</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={biasReversal}
                  onChange={(e) => setBiasReversal(e.target.checked)}
                  style={{ width: "16px", height: "16px", accentColor: "var(--accent-blue)" }}
                />
                <span className="label-text" style={{ margin: 0 }}>Bias Reversal during trade</span>
              </label>
            </div>

            {/* Mode-Specific Execution Inputs */}
            {entryMode === "quick" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "16px", marginBottom: "20px", borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
                <div>
                  <label className="label-text">Trade Side</label>
                  <select
                    className="input-field"
                    value={quickSide}
                    onChange={(e) => setQuickSide(e.target.value as "BUY" | "SELL")}
                  >
                    <option value="BUY">Long (BUY)</option>
                    <option value="SELL">Short (SELL)</option>
                  </select>
                </div>
                <div>
                  <label className="label-text">Entry Price</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="Entry price"
                    className="input-field"
                    value={quickEntryPrice}
                    onChange={(e) => setQuickEntryPrice(e.target.value)}
                    required={entryMode === "quick"}
                  />
                </div>
                <div>
                  <label className="label-text">Exit Price (Optional)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="Exit price (leave blank if open)"
                    className="input-field"
                    value={quickExitPrice}
                    onChange={(e) => setQuickExitPrice(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-text">Quantity / Contracts</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="Quantity"
                    className="input-field"
                    value={quickQuantity}
                    onChange={(e) => setQuickQuantity(e.target.value)}
                    required={entryMode === "quick"}
                  />
                </div>
              </div>
            ) : (
              /* Executions scale sub-form (Advanced Mode) */
              <div style={{ marginBottom: "20px", borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
                <h4 style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Scale Executions List</span>
                  <button type="button" className="btn-secondary" style={{ padding: "4px 8px", fontSize: "0.7rem" }} onClick={handleAddExecutionRow}>
                    + Add Scale Entry/Exit
                  </button>
                </h4>
                {executionsInput.map((exec, idx) => (
                  <div key={idx} style={{ display: "flex", gap: "12px", marginBottom: "8px", alignItems: "center" }}>
                    <div style={{ width: "80px" }}>
                      <select
                        className="input-field"
                        style={{ padding: "6px" }}
                        value={exec.side}
                        onChange={(e) => handleExecutionChange(idx, "side", e.target.value)}
                      >
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                    </div>
                    <div style={{ flex: 2 }}>
                      <input
                        type="number"
                        step="any"
                        placeholder="Fill Price"
                        className="input-field"
                        style={{ padding: "6px" }}
                        value={exec.fill_price}
                        onChange={(e) => handleExecutionChange(idx, "fill_price", e.target.value)}
                        required={entryMode === "advanced"}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <input
                        type="number"
                        placeholder="Quantity"
                        className="input-field"
                        style={{ padding: "6px" }}
                        value={exec.quantity}
                        onChange={(e) => handleExecutionChange(idx, "quantity", e.target.value)}
                        required={entryMode === "advanced"}
                      />
                    </div>
                    {executionsInput.length > 1 && (
                      <button type="button" style={{ background: "transparent", border: "none", color: "var(--accent-red)", cursor: "pointer" }} onClick={() => handleRemoveExecutionRow(idx)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Tag Selection */}
            <div style={{ marginBottom: "20px", borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
              <label className="label-text">Metadata tags (Setups, Emotions, Behaviors)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
                {availableTags.map((tag) => {
                  const selected = selectedTags.includes(tag.tag_name);
                  return (
                    <button
                      key={tag.tag_id}
                      type="button"
                      className="btn-secondary"
                      style={{
                        padding: "4px 10px",
                        fontSize: "0.75rem",
                        borderRadius: "16px",
                        border: `1px solid ${selected ? tag.color_code : "var(--border-color)"}`,
                        backgroundColor: selected ? `${tag.color_code}22` : "transparent",
                        color: selected ? tag.color_code : "var(--text-primary)"
                      }}
                      onClick={() => toggleTag(tag.tag_name)}
                    >
                      {tag.tag_name}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", maxWidth: "400px" }}>
                <input
                  type="text"
                  placeholder="Create new custom tag..."
                  className="input-field"
                  style={{ padding: "6px 12px", fontSize: "0.8rem", margin: 0 }}
                  value={customTagName}
                  onChange={(e) => setCustomTagName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "6px 12px", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                  onClick={handleCreateCustomTag}
                >
                  + Add Tag
                </button>
              </div>
            </div>

            {/* Note entry */}
            <div style={{ marginBottom: "20px" }}>
              <label className="label-text">Trade Journal Notes (Psychology, Emotion, Analysis)</label>
              <textarea
                placeholder="Write trade details here. Mention emotional states, reasons for targets, or any mistakes..."
                className="input-field"
                style={{ height: "80px", resize: "vertical" }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={() => setIsLoggingOpen(false)}
              >
                Close Logger
              </button>
              <button type="submit" className="btn-primary">Save Journal Record</button>
            </div>
          </form>
        </div>
      )}

      {/* Top Level KPI Dashboard Grid */}
      <div className="dashboard-grid">
        {/* Net realized pnl */}
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <span className="label-text">Realized Net P&L</span>
            <h2 className={getPnlClass(trades.reduce((acc, t) => acc + Number(t.net_pnl), 0))} style={{ fontSize: "2rem" }}>
              {formatMetric(trades.reduce((acc, t) => acc + Number(t.net_pnl), 0), true)}
            </h2>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "12px" }}>
            <span>Account Equity</span>
            <span style={{ color: "var(--text-primary)" }}>
              {privacyMode ? "$***.**" : `$${(initialBalance + trades.reduce((acc, t) => acc + Number(t.net_pnl), 0)).toLocaleString()}`}
            </span>
          </div>
        </div>

        {/* Win Rate */}
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <span className="label-text">Win Rate Percentage</span>
            <h2 style={{ fontSize: "2rem", color: stats.winRate >= 0.5 ? "var(--accent-green)" : stats.winRate >= 0.35 ? "var(--accent-gold)" : "var(--accent-red)" }}>
              {(stats.winRate * 100).toFixed(1)}%
            </h2>
          </div>
          <div style={{ padding: "0 12px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              <span>Ratio</span>
              <span>{stats.winningTrades}W - {stats.losingTrades}L</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
              <span>Avg Win / Loss</span>
              <span>
                ${stats.winningTrades > 0 ? ((stats.grossProfits || 0) / stats.winningTrades).toFixed(0) : 0} / 
                -${stats.losingTrades > 0 ? ((stats.grossLosses || 0) / stats.losingTrades).toFixed(0) : 0}
              </span>
            </div>
          </div>
        </div>

        {/* Expectancy & Profit Factor */}
        <div className="glass-panel" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <span className="label-text">Profit Factor (PF)</span>
            <h2 style={{ fontSize: "2rem", color: stats.profitFactor >= 1.5 ? "var(--accent-green)" : stats.profitFactor >= 1.0 ? "var(--accent-gold)" : "var(--accent-red)" }}>
              {stats.profitFactor.toFixed(2)}
            </h2>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "12px" }}>
            <span>Expectancy</span>
            <span style={{ color: "var(--accent-blue)" }}>
              {displayUnit === "R" ? `+${stats.expectancyR.toFixed(2)}R` : `$${stats.expectancyNominal.toFixed(2)}`}
            </span>
          </div>
        </div>

        {/* Zella Score Gauge */}
        <div className="glass-panel glow-effect" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", border: "1px solid var(--border-hover)" }}>
          <div>
            <span className="label-text" style={{ color: "var(--accent-blue)" }}>Zella Performance Score</span>
            <h2 style={{ fontSize: "2.2rem", fontWeight: "bold", background: "linear-gradient(135deg, #00e5ff 0%, #00e676 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {stats.zellaScore}/100
            </h2>
          </div>
          <div style={{ padding: "0 12px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              <span>MDD / Adherence</span>
              <span>{stats.maxDrawdown.toFixed(1)}% / {(stats.ruleAdherenceRate * 100).toFixed(0)}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "4px" }}>
              <span>Recovery Factor</span>
              <span>
                {stats.maxDrawdown > 0 ? (trades.reduce((acc, t) => acc + Number(t.net_pnl), 0) / (initialBalance * stats.maxDrawdown / 100)).toFixed(2) : "5.00"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Gamification and Discipline Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px", marginBottom: "20px" }}>
        {/* Streak component */}
        <div className="glass-panel" style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ padding: "12px", background: activeStreak > 0 ? "var(--gold-bg)" : "var(--neutral-bg)", borderRadius: "50%", color: activeStreak > 0 ? "var(--accent-gold)" : "var(--text-secondary)" }}>
            <Flame size={24} className={activeStreak > 0 ? "glow-effect" : ""} style={{ fill: activeStreak > 0 ? "var(--accent-gold)" : "transparent" }} />
          </div>
          <div>
            <span className="label-text">Current Day Streak</span>
            <h3 style={{ fontSize: "1.2rem" }}>
              {activeStreak > 0 ? `${activeStreak} Consecutive Profitable Days!` : "No active winning streak. Focus on consistency!"}
            </h3>
          </div>
        </div>

        {/* Cost of indiscipline warnings */}
        <div className="glass-panel" style={{ display: "flex", alignItems: "center", gap: "16px", border: stats.costOfIndiscipline > 0 ? "1px solid var(--red-border)" : "1px solid var(--border-color)" }}>
          <div style={{ padding: "12px", background: stats.costOfIndiscipline > 0 ? "var(--red-bg-strong)" : "var(--green-bg-strong)", borderRadius: "50%", color: stats.costOfIndiscipline > 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
            <Award size={24} />
          </div>
          <div>
            <span className="label-text" style={{ color: stats.costOfIndiscipline > 0 ? "var(--accent-red)" : "var(--accent-green)" }}>Cost of Indiscipline Penalty</span>
            <h3 style={{ fontSize: "1.2rem", color: stats.costOfIndiscipline > 0 ? "var(--accent-red)" : "var(--text-primary)" }}>
              {stats.costOfIndiscipline > 0 ? `-${formatMetric(stats.costOfIndiscipline, true)} lost on rule breaches!` : "Disciplined Trading Edge ($0 penalty)"}
            </h3>
          </div>
        </div>

        {/* Risk Management Panel */}
        <div className="glass-panel" style={{ border: "1px solid rgba(0, 229, 255, 0.15)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <span className="label-text" style={{ color: "var(--accent-blue)", fontWeight: "500", marginBottom: "8px" }}>Risk Management Parameters</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div>
                <label className="label-text" style={{ fontSize: "0.75rem" }}>Daily Profit Target ($)</label>
                <input
                  type="number"
                  className="input-field"
                  style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                  value={profitTarget}
                  onChange={(e) => setProfitTarget(e.target.value)}
                />
              </div>
              <div>
                <label className="label-text" style={{ fontSize: "0.75rem" }}>Daily Max Loss ($)</label>
                <input
                  type="number"
                  className="input-field"
                  style={{ padding: "6px 10px", fontSize: "0.85rem" }}
                  value={maxLoss}
                  onChange={(e) => setMaxLoss(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "8px" }}>
            Triggers banners when today's realized P&L breaches limits.
          </div>
        </div>
      </div>

      {/* Recent Trades Table list */}
      <div className="glass-panel">
        <h3 style={{ marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Recent Journal Entries</span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Total: {trades.length} trades logged</span>
        </h3>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                <th style={{ padding: "12px 8px" }}>Timestamp</th>
                <th style={{ padding: "12px 8px" }}>Symbol</th>
                <th style={{ padding: "12px 8px" }}>Status</th>
                <th style={{ padding: "12px 8px" }}>Net P&L</th>
                <th style={{ padding: "12px 8px" }}>R-Multiple</th>
                <th style={{ padding: "12px 8px" }}>Rules</th>
                <th style={{ padding: "12px 8px" }}>Regime Context</th>
                <th style={{ padding: "12px 8px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "20px", textAlign: "center", color: "var(--text-secondary)" }}>
                    No trades logged. Click "Log Manual Trade" to add your first execution.
                  </td>
                </tr>
              ) : (
                trades.map((t) => {
                  const regime = t.market_context[0]?.regime_type || "Unknown";
                  const remainingContracts = getRemainingQuantity(t.executions);
                  return (
                    <tr key={t.trade_id} style={{ borderBottom: "1px solid var(--neutral-bg)", fontSize: "0.9rem" }}>
                      <td style={{ padding: "12px 8px", color: "var(--text-secondary)" }}>
                        {new Date(t.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td style={{ padding: "12px 8px", fontWeight: "600" }}>{t.symbol}</td>
                      <td style={{ padding: "12px 8px" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <span
                            onClick={() => handleToggleTradeStatus(t.trade_id, t.status)}
                            title="Click to toggle status manually"
                            style={{
                              padding: "2px 6px",
                              fontSize: "0.75rem",
                              borderRadius: "4px",
                              backgroundColor: t.status === "CLOSED" ? "var(--neutral-bg)" : "var(--accent-bg-strong)",
                              color: t.status === "CLOSED" ? "var(--text-secondary)" : "var(--accent-blue)",
                              cursor: "pointer",
                              border: "1px solid transparent",
                              transition: "all 0.2s"
                            }}
                            onMouseOver={(e) => { e.currentTarget.style.borderColor = t.status === "CLOSED" ? "rgba(255,255,255,0.2)" : "rgba(0,229,255,0.4)" }}
                            onMouseOut={(e) => { e.currentTarget.style.borderColor = "transparent" }}
                          >
                            {t.status}
                          </span>
                          {t.status === "OPEN" && remainingContracts > 0 && (
                            <span style={{ fontSize: "0.75rem", color: "var(--accent-gold)", backgroundColor: "var(--gold-bg)", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" }}>
                              {remainingContracts} rem
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "12px 8px", fontWeight: "600" }} className={getPnlClass(t.net_pnl)}>
                        {formatMetric(Number(t.net_pnl), true, t.symbol)}
                      </td>
                      <td style={{ padding: "12px 8px" }} className={getPnlClass(t.r_multiple)}>
                        {Number(t.r_multiple) >= 0 ? "+" : ""}{Number(t.r_multiple).toFixed(2)}R
                      </td>
                      <td style={{ padding: "12px 8px" }}>
                        <span style={{
                          color: t.rules_followed ? "var(--accent-green)" : "var(--accent-red)"
                        }}>
                          {t.rules_followed ? "Disciplined" : "Breached"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                        {regime}
                      </td>
                      <td style={{ padding: "12px 8px" }}>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {t.executions.length >= 2 && (
                            <button
                              className="btn-secondary"
                              style={{ padding: "4px 8px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "4px" }}
                              onClick={() => onSelectTradeForReplay(t)}
                            >
                              <Play size={12} /> Replay
                            </button>
                          )}
                          <button
                            className="btn-secondary"
                            style={{ padding: "4px 8px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "4px" }}
                            onClick={() => onSetActiveTab("coach")}
                          >
                            <MessageSquare size={12} /> Coach
                          </button>
                          <button
                            className="btn-secondary"
                            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                            onClick={() => {
                              setEditingTrade(t);
                              setEditSymbol(t.symbol);
                              setEditStopLoss(t.stop_loss ? String(t.stop_loss) : "");
                              setEditBias((t.bias || "RANGE") as "LONG" | "SHORT" | "RANGE");
                              setEditBiasReversal(!!t.bias_reversal);
                              setEditTradeType((t.trade_type || "BREAKOUT") as "BREAKOUT" | "RANGE");
                              setEditStatus(t.status);
                              setEditRulesFollowed(t.rules_followed);
                              setEditNotes(t.notes || "");
                              setEditExecutions(t.executions || []);
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingTrade && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "var(--overlay-bg)",
          backdropFilter: "blur(8px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1000,
          padding: "20px"
        }}>
          <div className="glass-panel" style={{
            width: "100%",
            maxWidth: "680px",
            maxHeight: "90vh",
            overflowY: "auto",
            border: "1px solid var(--border-hover)",
            boxShadow: "0 0 24px var(--border-hover)",
            padding: "24px",
            position: "relative"
          }}>
            <h3 style={{ marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Edit Trade Record</span>
              <button className="btn-secondary" style={{ padding: "4px 8px", fontSize: "0.75rem" }} onClick={() => setEditingTrade(null)}>
                X
              </button>
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "16px", marginBottom: "20px" }}>
              <div>
                <label className="label-text">Symbol</label>
                <input
                  type="text"
                  className="input-field"
                  value={editSymbol}
                  onChange={(e) => setEditSymbol(e.target.value)}
                />
              </div>
              <div>
                <label className="label-text">Stop Loss (Optional)</label>
                <input
                  type="number"
                  step="any"
                  className="input-field"
                  value={editStopLoss}
                  onChange={(e) => setEditStopLoss(e.target.value)}
                  placeholder="Stop price"
                />
              </div>
              <div>
                <label className="label-text">Market Bias</label>
                <select
                  className="input-field"
                  value={editBias}
                  onChange={(e) => setEditBias(e.target.value as "LONG" | "SHORT" | "RANGE")}
                >
                  <option value="LONG">Long</option>
                  <option value="SHORT">Short</option>
                  <option value="RANGE">Range</option>
                </select>
              </div>
              <div>
                <label className="label-text">Setup Type</label>
                <select
                  className="input-field"
                  value={editTradeType}
                  onChange={(e) => setEditTradeType(e.target.value as "BREAKOUT" | "RANGE")}
                >
                  <option value="BREAKOUT">Breakout</option>
                  <option value="RANGE">Range Trade</option>
                </select>
              </div>
              <div>
                <label className="label-text">Rules Followed?</label>
                <select
                  className="input-field"
                  value={editRulesFollowed ? "yes" : "no"}
                  onChange={(e) => setEditRulesFollowed(e.target.value === "yes")}
                >
                  <option value="yes">YES</option>
                  <option value="no">NO</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "24px", marginBottom: "20px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editStatus === "CLOSED"}
                  onChange={(e) => setEditStatus(e.target.checked ? "CLOSED" : "OPEN")}
                  style={{ width: "16px", height: "16px", accentColor: "var(--accent-blue)" }}
                />
                <span className="label-text" style={{ margin: 0 }}>Trade Closed</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={editBiasReversal}
                  onChange={(e) => setEditBiasReversal(e.target.checked)}
                  style={{ width: "16px", height: "16px", accentColor: "var(--accent-blue)" }}
                />
                <span className="label-text" style={{ margin: 0 }}>Bias Reversal during trade</span>
              </label>
            </div>

            {/* Inline Execution Editor */}
            <div style={{ borderTop: "1px solid var(--border-color)", paddingTop: "16px", marginBottom: "20px" }}>
              <h4 style={{ fontSize: "0.95rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
                Manage Executions
              </h4>
              {editExecutions.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
                  No executions. Add one below to calculate P&L.
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                  {editExecutions.map((exec, idx) => (
                    <div key={exec.execution_id} style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", width: "30px" }}>
                        #{idx + 1}
                      </span>
                      <select
                        className="input-field"
                        style={{ padding: "6px", width: "80px" }}
                        value={exec.side}
                        onChange={(e) => handleEditExecution(exec.execution_id, { side: e.target.value })}
                      >
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                      <input
                        type="number"
                        step="any"
                        placeholder="Price"
                        className="input-field"
                        style={{ padding: "6px", flex: 2 }}
                        value={exec.fill_price}
                        onChange={(e) => handleEditExecution(exec.execution_id, { fill_price: e.target.value })}
                      />
                      <input
                        type="number"
                        step="any"
                        placeholder="Qty"
                        className="input-field"
                        style={{ padding: "6px", flex: 1 }}
                        value={exec.quantity}
                        onChange={(e) => handleEditExecution(exec.execution_id, { quantity: e.target.value })}
                      />
                      <button
                        type="button"
                        style={{ background: "transparent", border: "none", color: "var(--accent-red)", cursor: "pointer", padding: "4px" }}
                        onClick={() => handleDeleteExecution(exec.execution_id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Sub-form: Add Execution */}
              <div style={{ background: "rgba(13, 22, 36, 0.3)", padding: "12px", borderRadius: "8px", border: "1px dashed var(--border-color)" }}>
                <h5 style={{ fontSize: "0.85rem", color: "var(--accent-blue)", marginBottom: "8px" }}>
                  + Add Execution
                </h5>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <select
                    className="input-field"
                    style={{ padding: "6px", width: "85px" }}
                    value={newExecSide}
                    onChange={(e) => setNewExecSide(e.target.value as "BUY" | "SELL")}
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                  <input
                    type="number"
                    step="any"
                    placeholder="Fill Price"
                    className="input-field"
                    style={{ padding: "6px", flex: 2 }}
                    value={newExecPrice}
                    onChange={(e) => setNewExecPrice(e.target.value)}
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Qty"
                    className="input-field"
                    style={{ padding: "6px", flex: 1 }}
                    value={newExecQty}
                    onChange={(e) => setNewExecQty(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: "6px 12px", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                    onClick={handleAddExecutionToEditTrade}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div style={{ marginBottom: "20px" }}>
              <label className="label-text">Trade Notes</label>
              <textarea
                className="input-field"
                style={{ height: "70px", resize: "vertical" }}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>

            {/* Footer Buttons */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ color: "var(--accent-red)", borderColor: "var(--red-border)" }}
                onClick={() => handleDeleteTrade(editingTrade.trade_id)}
              >
                Delete Trade
              </button>

              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingTrade(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveEditedTrade}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
