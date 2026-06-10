import React, { useEffect, useRef, useState, useCallback } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { gradeGuess, type OHLCV, type GuessDirection } from "../lib/dojoGrading";
import { updateStats, initialStats, type DojoStats, type GradeOutcome } from "../lib/dojoStats";

interface Scenario {
  symbol: string;
  period1: string;
  period2: string;
  setup: OHLCV[];
  reveal: OHLCV[];
}

type GameStatus = "loading" | "playing" | "revealed" | "error";

function deriveOutcome(guess: GuessDirection, correct: boolean): GradeOutcome {
  if (guess === "PASS") {
    return correct ? "PASS_CORRECT" : "PASS_INCORRECT";
  }
  if (guess === "LONG") {
    return correct ? "LONG_WIN" : "LONG_LOSS";
  }
  return correct ? "SHORT_WIN" : "SHORT_LOSS";
}

export const TrainingDojo: React.FC = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [status, setStatus] = useState<GameStatus>("loading");
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [stats, setStats] = useState<DojoStats>(initialStats);
  const [lastResult, setLastResult] = useState<"WIN" | "LOSS" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const fetchScenario = useCallback(async () => {
    setStatus("loading");
    setLastResult(null);
    try {
      const res = await fetch("http://localhost:5000/api/dojo/scenario");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setScenario(data);
      setStatus("playing");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch scenario.";
      setErrorMsg(message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchScenario();
  }, [fetchScenario]);

  // Setup chart
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (status === "loading" || status === "error") return;
    if (!scenario || scenario.setup.length === 0) return;

    // Cleanup previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "#1e293b" }, // tailwind slate-800
        textColor: "#cbd5e1", // tailwind slate-300
      },
      grid: {
        vertLines: { color: "#334155" },
        horzLines: { color: "#334155" },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        borderColor: "#475569",
        timeVisible: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    series.setData(scenario.setup);
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [scenario, status]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (status !== "playing") return;
      if (e.key.toLowerCase() === "l") handleGuess("LONG");
      if (e.key.toLowerCase() === "s") handleGuess("SHORT");
      if (e.key.toLowerCase() === "p") handleGuess("PASS");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status, scenario]);

  const handleGuess = (direction: GuessDirection) => {
    if (!scenario || !seriesRef.current || status !== "playing") return;

    // Append reveal data
    for (const candle of scenario.reveal) {
      seriesRef.current.update(candle);
    }

    // Grade using the shared 0.5× ATR logic
    const result = gradeGuess(scenario.setup, scenario.reveal, direction);
    const outcome = deriveOutcome(direction, result.correct);

    setLastResult(result.correct ? "WIN" : "LOSS");
    setStats(prev => updateStats(prev, outcome));
    setStatus("revealed");
  };

  const accuracyPct = stats.accuracy.total > 0
    ? Math.round((stats.accuracy.correct / stats.accuracy.total) * 100)
    : 0;
  const selectivityPct = stats.selectivity.total > 0
    ? Math.round((stats.selectivity.passCount / stats.selectivity.total) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 text-white p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold text-slate-100">Training Dojo</h2>
        <div className="flex gap-6 text-lg font-mono">
          <div>
            Decision Accuracy:{" "}
            <span className="text-emerald-400">{stats.accuracy.correct}</span>
            {" / "}
            {stats.accuracy.total}
            {stats.accuracy.total > 0 && (
              <span className="text-slate-400 ml-1">({accuracyPct}%)</span>
            )}
          </div>
          <div>
            Selectivity:{" "}
            <span className="text-amber-400">{stats.selectivity.passCount}</span>
            {" / "}
            {stats.selectivity.total}
            {stats.selectivity.total > 0 && (
              <span className="text-slate-400 ml-1">({selectivityPct}%)</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[400px] border border-slate-700 rounded-lg overflow-hidden relative">
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800/80 z-10">
            <span className="text-xl animate-pulse">Loading scenario...</span>
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800/80 z-10">
            <div className="text-center">
              <p className="text-red-400 text-xl mb-4">{errorMsg}</p>
              <button onClick={fetchScenario} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded">Retry</button>
            </div>
          </div>
        )}
        {lastResult && (
          <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-6 py-2 rounded shadow-lg text-2xl font-bold z-10 ${lastResult === "WIN" ? "bg-emerald-500" : "bg-red-500"}`}>
            {lastResult === "WIN" ? "CORRECT" : "WRONG"}
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      <div className="mt-4 flex gap-4 justify-center items-center h-16">
        {status === "playing" && (
          <>
            <button 
              onClick={() => handleGuess("LONG")}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded shadow transition-colors flex items-center gap-2"
            >
              LONG <span className="text-emerald-200 text-sm font-normal border border-emerald-400 rounded px-1">L</span>
            </button>
            <button 
              onClick={() => handleGuess("SHORT")}
              className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded shadow transition-colors flex items-center gap-2"
            >
              SHORT <span className="text-red-200 text-sm font-normal border border-red-400 rounded px-1">S</span>
            </button>
            <button 
              onClick={() => handleGuess("PASS")}
              className="px-8 py-3 bg-slate-600 hover:bg-slate-500 text-white font-bold rounded shadow transition-colors flex items-center gap-2"
            >
              PASS <span className="text-slate-300 text-sm font-normal border border-slate-400 rounded px-1">P</span>
            </button>
            {scenario && <div className="text-slate-400 ml-4 font-mono">Ticker: ???</div>}
          </>
        )}
        {status === "revealed" && scenario && (
          <>
            <button 
              onClick={fetchScenario}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded shadow transition-colors"
            >
              Next Setup
            </button>
            <div className="text-slate-300 ml-4 font-mono">
              Revealed: <span className="font-bold text-white">{scenario.symbol}</span> ({scenario.period1} to {scenario.period2})
            </div>
          </>
        )}
      </div>
    </div>
  );
};
