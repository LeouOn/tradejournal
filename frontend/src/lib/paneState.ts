export type ViewMode = "split" | "minimized" | "maximized";

const VALID_VIEW_MODES: ViewMode[] = ["split", "minimized", "maximized"];
const SPLIT_MIN = 10;
const SPLIT_MAX = 90;

/**
 * Clamp a split percentage value between min and max (inclusive).
 */
export function clampSplitPercent(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse and validate a stored view mode string.
 * Returns the stored value if it's a valid ViewMode, otherwise defaults to "split".
 */
export function getInitialViewMode(stored: string | null): ViewMode {
  if (stored !== null && VALID_VIEW_MODES.includes(stored as ViewMode)) {
    return stored as ViewMode;
  }
  return "split";
}

/**
 * Parse and validate a stored split percentage string.
 * Returns the parsed number if it's a valid integer in [10, 90], otherwise returns the default.
 */
export function getInitialSplitPercent(stored: string | null, defaultPercent: number): number {
  if (stored === null) return defaultPercent;
  const parsed = Number(stored);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) return defaultPercent;
  if (parsed < SPLIT_MIN || parsed > SPLIT_MAX) return defaultPercent;
  return parsed;
}
