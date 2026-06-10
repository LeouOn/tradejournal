// Mirrored from backend/src/utils/dojoGrading.ts — keep in sync until shared workspace.
// DO NOT modify the backend version independently; any changes here must be reflected there.

export interface OHLCV {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Calculate the Average True Range over the last `period` candles.
 * True Range for candle i = max(high-low, |high - prevClose|, |low - prevClose|)
 * ATR = average of the last `period` True Ranges.
 */
export function calculateATR(candles: OHLCV[], period: number = 14): number {
  if (candles.length < 2) {
    throw new Error("Need at least 2 candles to compute ATR");
  }

  const startIndex = Math.max(1, candles.length - period);
  let sum = 0;
  for (let i = startIndex; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    sum += tr;
  }
  return sum / (candles.length - startIndex);
}

export type GuessDirection = "LONG" | "SHORT" | "PASS";

export interface GradeResult {
  correct: boolean;
  targetHit: boolean;
}

/**
 * Grade a user's guess against the reveal candles.
 *
 * - thresholdMultiplier defaults to 0.5 (NOT 2.5)
 * - LONG: correct if upside target hit first; loss if downside stop hit first
 * - SHORT: symmetric to LONG
 * - PASS: correct if neither direction clears threshold; loss if either does
 * - Flat market (no target/stop hit): LONG/SHORT graded on final close direction
 */
export function gradeGuess(
  setup: OHLCV[],
  reveal: OHLCV[],
  guess: GuessDirection,
  thresholdMultiplier: number = 0.5
): GradeResult {
  const atr = calculateATR(setup);
  const threshold = atr * thresholdMultiplier;
  const setupClose = setup[setup.length - 1].close;

  const upTarget = setupClose + threshold;
  const downTarget = setupClose - threshold;

  // Walk through reveal candles chronologically
  for (const candle of reveal) {
    const upHit = candle.high >= upTarget;
    const downHit = candle.low <= downTarget;

    if (guess === "LONG") {
      // Per spec: if both trigger, it's a LOSS (stopped out)
      if (downHit) {
        return { correct: false, targetHit: true };
      }
      if (upHit) {
        return { correct: true, targetHit: true };
      }
    } else if (guess === "SHORT") {
      if (upHit) {
        return { correct: false, targetHit: true };
      }
      if (downHit) {
        return { correct: true, targetHit: true };
      }
    } else {
      // PASS: if either direction clears, it's a loss
      if (upHit || downHit) {
        return { correct: false, targetHit: true };
      }
    }
  }

  // No target hit — flat market case
  if (guess === "PASS") {
    return { correct: true, targetHit: false };
  }

  if (reveal.length === 0) {
    return { correct: false, targetHit: false };
  }

  const finalClose = reveal[reveal.length - 1].close;
  if (guess === "LONG") {
    return { correct: finalClose > setupClose, targetHit: false };
  }
  // SHORT
  return { correct: finalClose < setupClose, targetHit: false };
}
