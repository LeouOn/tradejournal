import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { clampSplitPercent, getInitialViewMode, getInitialSplitPercent, type ViewMode } from "../lib/paneState";

const LS_KEY_VIEW_MODE = "appLayout_viewMode";
const LS_KEY_SPLIT_PERCENT = "appLayout_splitPercent";
const RESIZER_WIDTH = 4;
const MINIMIZED_WIDTH = 48;

interface AppLayoutProps {
  leftPane: ReactNode;
  rightPane: ReactNode;
  minPercent?: number;
  maxPercent?: number;
  viewMode: ViewMode;
  splitPercent: number;
  onSplitChange: (percent: number) => void;
}

export default function AppLayout({
  leftPane,
  rightPane,
  minPercent = 20,
  maxPercent = 70,
  viewMode,
  splitPercent,
  onSplitChange,
}: AppLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      onSplitChange(clampSplitPercent(Math.round(percent), minPercent, maxPercent));
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [minPercent, maxPercent, onSplitChange]);

  const isMinimized = viewMode === "minimized";
  const isMaximized = viewMode === "maximized";

  const leftWidth = isMinimized
    ? MINIMIZED_WIDTH
    : isMaximized
      ? "100%"
      : `${splitPercent}%`;
  const showRight = !isMaximized;
  const showResizer = viewMode === "split";

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        display: "flex",
        overflow: "hidden",
      }}
    >
      {/* Left Pane */}
      <div
        style={{
          width: leftWidth,
          minWidth: isMinimized ? MINIMIZED_WIDTH : 0,
          maxWidth: isMinimized ? MINIMIZED_WIDTH : (isMaximized ? "100%" : `${maxPercent}%`),
          borderRight: showResizer ? "none" : "1px solid var(--border-color)",
          background: "var(--bg-secondary)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "width 200ms ease-out",
          flexShrink: 0,
        }}
      >
        {leftPane}
      </div>

      {/* Resizer Handle */}
      {showResizer && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            width: RESIZER_WIDTH,
            cursor: "col-resize",
            background: "var(--border-color)",
            position: "relative",
            flexShrink: 0,
            zIndex: 10,
          }}
        >
          {/* Visual grip indicator */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "2px",
              height: "32px",
              background: "var(--text-secondary)",
              borderRadius: "1px",
              opacity: 0.4,
            }}
          />
        </div>
      )}

      {/* Right Pane */}
      {showRight && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-primary)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {rightPane}
        </div>
      )}
    </div>
  );
}

/**
 * Hook to manage layout state with localStorage persistence.
 */
export function useLayoutState(defaultSplitPercent = 40) {
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    getInitialViewMode(localStorage.getItem(LS_KEY_VIEW_MODE))
  );
  const [splitPercent, setSplitPercent] = useState<number>(() =>
    getInitialSplitPercent(localStorage.getItem(LS_KEY_SPLIT_PERCENT), defaultSplitPercent)
  );

  const handleModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(LS_KEY_VIEW_MODE, mode);
  }, []);

  const handleSplitChange = useCallback((percent: number) => {
    setSplitPercent(percent);
    localStorage.setItem(LS_KEY_SPLIT_PERCENT, String(percent));
  }, []);

  return { viewMode, splitPercent, handleModeChange, handleSplitChange };
}
