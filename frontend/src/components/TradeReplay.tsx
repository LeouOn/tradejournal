import { useRef, useEffect, useState } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import type { Trade } from "./Dashboard";

interface TradeReplayProps {
  trade: Trade;
}

export default function TradeReplay({ trade }: TradeReplayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 5 | 10>(1);
  const [currentProgress, setCurrentProgress] = useState(0); // 0 to 100 percentage
  const [tickData, setTickData] = useState<number[]>([]);
  const animationFrameId = useRef<number | null>(null);

  const executions = [...trade.executions].sort(
    (a, b) => new Date(a.execution_timestamp).getTime() - new Date(b.execution_timestamp).getTime()
  );

  const entryPrice = Number(executions[0]?.fill_price || 100);
  const exitPrice = Number(executions[executions.length - 1]?.fill_price || 105);
  const direction = executions[0]?.side || "BUY"; // BUY = Long, SELL = Short

  // 1. Generate 200 ticks of price action that connect entry to exit price logically
  useEffect(() => {
    const ticks: number[] = [];
    
    // Start price slightly before entry price
    let currentPrice = entryPrice - (direction === "BUY" ? 5 : -5);
    
    // Ticks 0 - 50: Approach entry
    const step1 = (entryPrice - currentPrice) / 50;
    for (let i = 0; i < 50; i++) {
      currentPrice += step1 + (Math.random() - 0.5) * (entryPrice * 0.001);
      ticks.push(currentPrice);
    }
    
    // Exact entry price at index 50
    ticks[50] = entryPrice;

    // Ticks 51 - 150: Fluctuate between entry and exit (intraday price movement)
    currentPrice = entryPrice;
    const step2 = (exitPrice - entryPrice) / 100;
    for (let i = 1; i < 100; i++) {
      // Add random walk drift towards exit
      currentPrice += step2 + (Math.random() - 0.5) * (entryPrice * 0.002);
      ticks.push(currentPrice);
    }
    
    // Exact exit price at index 150
    ticks[150] = exitPrice;

    // Ticks 151 - 200: Post-exit fluctuations
    currentPrice = exitPrice;
    const step3 = (exitPrice - (exitPrice + (Math.random() - 0.5) * (exitPrice * 0.02))) / 50;
    for (let i = 0; i < 50; i++) {
      currentPrice -= step3 + (Math.random() - 0.5) * (entryPrice * 0.001);
      ticks.push(currentPrice);
    }

    setTickData(ticks);
    setCurrentProgress(0);
    setIsPlaying(false);
  }, [trade]);

  // 2. Playback progress control loop
  useEffect(() => {
    if (isPlaying) {
      const updateProgress = () => {
        setCurrentProgress((prev) => {
          const next = prev + 0.5 * playbackSpeed;
          if (next >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return next;
        });
        animationFrameId.current = requestAnimationFrame(updateProgress);
      };
      animationFrameId.current = requestAnimationFrame(updateProgress);
    } else {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    }

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isPlaying, playbackSpeed]);

  // 3. Canvas rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || tickData.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear and size canvas
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Bounding price box
    const maxPrice = Math.max(...tickData) * 1.002;
    const minPrice = Math.min(...tickData) * 0.998;
    const priceRange = maxPrice - minPrice;

    const getX = (index: number) => (index / (tickData.length - 1)) * (width - 60) + 30;
    const getY = (price: number) => height - 30 - ((price - minPrice) / priceRange) * (height - 60);

    // Draw grid lines
    ctx.strokeStyle = "rgba(74, 120, 152, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const gridY = getY(minPrice + (priceRange / 5) * i);
      ctx.beginPath();
      ctx.moveTo(30, gridY);
      ctx.lineTo(width - 30, gridY);
      ctx.stroke();
    }

    // Determine current index to draw up to
    const maxVisibleIndex = Math.floor((currentProgress / 100) * (tickData.length - 1));

    // Draw Price Path
    if (maxVisibleIndex > 0) {
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(tickData[0]));
      
      for (let i = 1; i <= maxVisibleIndex; i++) {
        ctx.lineTo(getX(i), getY(tickData[i]));
      }

      // Stroke gradient line
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#00e5ff"); // Hex for --accent-blue
      gradient.addColorStop(1, "rgba(0, 229, 255, 0.4)");
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(0, 229, 255, 0.3)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0; // reset
    }

    // Draw Entry Marker (at index 50)
    if (maxVisibleIndex >= 50) {
      const entryX = getX(50);
      const entryY = getY(entryPrice);

      ctx.beginPath();
      ctx.arc(entryX, entryY, 6, 0, 2 * Math.PI);
      ctx.fillStyle = direction === "BUY" ? "#00e676" : "#ff2d55"; // Hex for --accent-green / --accent-red
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      // Label flag
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px Outfit";
      ctx.fillText(`${direction} @ ${entryPrice.toFixed(2)}`, entryX - 25, entryY - 14);
    }

    // Draw Exit Marker (at index 150)
    if (maxVisibleIndex >= 150) {
      const exitX = getX(150);
      const exitY = getY(exitPrice);
      const exitSide = direction === "BUY" ? "SELL" : "BUY";

      ctx.beginPath();
      ctx.arc(exitX, exitY, 6, 0, 2 * Math.PI);
      ctx.fillStyle = exitSide === "BUY" ? "#00e676" : "#ff2d55"; // Hex for --accent-green / --accent-red
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      // Label flag
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 9px Outfit";
      ctx.fillText(`${exitSide} @ ${exitPrice.toFixed(2)}`, exitX - 25, exitY - 14);
    }

    // Draw Axis Price labels on right edge
    ctx.fillStyle = "#94a3b8"; // Hex for --text-secondary
    ctx.font = "10px Outfit";
    ctx.fillText(maxPrice.toFixed(2), width - 55, 20);
    ctx.fillText(minPrice.toFixed(2), width - 55, height - 12);

  }, [currentProgress, tickData]);

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentProgress(0);
  };

  return (
    <div className="glass-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h3>Interactive Execution Replay: <span style={{ color: "var(--accent-blue)" }}>{trade.symbol}</span></h3>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            Trade logged on {new Date(trade.created_at).toLocaleDateString()}
          </span>
        </div>

        {/* Speed Controls */}
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginRight: "4px" }}>Speed:</span>
          {([1, 5, 10] as const).map((speed) => (
            <button
              key={speed}
              className="btn-secondary"
              style={{
                padding: "2px 6px",
                fontSize: "0.7rem",
                borderColor: playbackSpeed === speed ? "var(--accent-blue)" : "var(--border-color)",
                backgroundColor: playbackSpeed === speed ? "rgba(0, 229, 255, 0.1)" : "transparent"
              }}
              onClick={() => setPlaybackSpeed(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>

      {/* Render Canvas */}
      <div style={{ position: "relative", width: "100%", height: "260px", background: "rgba(13, 22, 36, 0.2)", borderRadius: "8px", border: "1px solid var(--border-color)", overflow: "hidden", marginBottom: "16px" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        {currentProgress === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(6, 12, 20, 0.7)", backdropFilter: "blur(2px)" }}>
            <button className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "8px" }} onClick={() => setIsPlaying(true)}>
              <Play size={16} /> Click to Play Execution Replay
            </button>
          </div>
        )}
      </div>

      {/* Bottom control panel */}
      <div style={{ display: "flex", gap: "16px", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            className="btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            className="btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
            onClick={handleReset}
          >
            <RotateCcw size={16} />
            Reset
          </button>
        </div>

        {/* Dynamic progress bar */}
        <div style={{ flex: 1, margin: "0 20px" }}>
          <div style={{ width: "100%", height: "4px", background: "var(--border-color)", borderRadius: "2px", position: "relative" }}>
            <div
              style={{
                height: "100%",
                background: "var(--accent-blue)",
                borderRadius: "2px",
                width: `${currentProgress}%`,
                boxShadow: "0 0 8px var(--accent-blue)"
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: direction === "BUY" ? "var(--accent-green)" : "var(--accent-red)" }}>● Entry:</span>
            <span style={{ color: "var(--text-primary)" }}>{entryPrice.toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: direction === "SELL" ? "var(--accent-green)" : "var(--accent-red)" }}>● Exit:</span>
            <span style={{ color: "var(--text-primary)" }}>{exitPrice.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
