import { calculateATR, gradeGuess, OHLCV } from "../utils/dojoGrading";

// Helper to build a candle quickly
function candle(
  time: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 0
): OHLCV {
  return { time, open, high, low, close, volume };
}

describe("calculateATR", () => {
  test("computes 14-period ATR from setup candles", () => {
    // Build 60 candles where the True Range is exactly 2.0 for each of the last 14
    // For TR to be 2.0 with high-low=2: set high=open+1, low=open-1, close=open
    // prev_close for first TR candle needs to exist, so we need 15 candles total (index 0 = prev, indices 1-14 = TRs)
    // But calculateATR takes all setup candles and uses the last 14 TRs (needs prev candle for each)
    // So we need at least 15 candles: indices 0..14, TRs computed for indices 1..14 (14 TRs)

    const candles: OHLCV[] = [];
    // Candle 0 (prev for the first TR computation)
    candles.push(candle("2026-01-01", 100, 101, 99, 100));
    // Candles 1..14: each has high-low = 2, and |high-prev_close| = |low-prev_close| = 1
    // So TR = max(2, 1, 1) = 2 for each
    for (let i = 1; i <= 14; i++) {
      const date = `2026-01-${String(i + 1).padStart(2, "0")}`;
      candles.push(candle(date, 100, 101, 99, 100));
    }

    const atr = calculateATR(candles, 14);
    expect(atr).toBeCloseTo(2.0, 10);
  });

  test("uses high-prev_close when it exceeds high-low", () => {
    // Each candle: high=103, low=102, close=100 (reset to 100 each time)
    // So prev_close always = 100 for the next candle
    // high-low = 1, |high-100| = 3, |low-100| = 2 => TR = 3
    const candles: OHLCV[] = [];
    candles.push(candle("2026-01-01", 100, 100, 100, 100)); // prev_close = 100
    for (let i = 1; i <= 14; i++) {
      const date = `2026-01-${String(i + 1).padStart(2, "0")}`;
      candles.push(candle(date, 100, 103, 102, 100));
    }

    const atr = calculateATR(candles, 14);
    expect(atr).toBeCloseTo(3.0, 10);
  });

  test("uses low-prev_close when it exceeds both others", () => {
    // prev_close = 100, current: high=101, low=96, close=97
    // high-low = 5, |high-prev_close| = 1, |low-prev_close| = 4 => TR = 5
    const candles: OHLCV[] = [];
    candles.push(candle("2026-01-01", 100, 100, 100, 100));
    for (let i = 1; i <= 14; i++) {
      const date = `2026-01-${String(i + 1).padStart(2, "0")}`;
      candles.push(candle(date, 97, 101, 96, 97));
    }

    const atr = calculateATR(candles, 14);
    expect(atr).toBeCloseTo(5.0, 10);
  });
});

describe("gradeGuess", () => {
  // Shared test data factory
  function makeSetupWithATR(atrValue: number, setupClose: number, count = 60): OHLCV[] {
    // Each candle TR = atrValue. We set high-low = atrValue exactly.
    // For TR=atrValue, we need high-low = atrValue and prev_close within [low, high].
    const candles: OHLCV[] = [];
    for (let i = 0; i < count; i++) {
      const date = `2026-01-${String(i + 1).padStart(2, "0")}`;
      candles.push(
        candle(date, setupClose, setupClose + atrValue / 2, setupClose - atrValue / 2, setupClose)
      );
    }
    return candles;
  }

  test("LONG wins when reveal goes up by more than threshold", () => {
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 102, 99.5, 101),
    ];

    const result = gradeGuess(setup, reveal, "LONG");
    expect(result.correct).toBe(true);
    expect(result.targetHit).toBe(true);
  });

  test("LONG loses when reveal hits downside first (stop-out)", () => {
    // ATR=2 => threshold=1.0
    // setupClose=100, stop = 99
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      // This candle's low hits 99 first (before high can reach 101)
      candle("2026-03-01", 100, 100.5, 98.5, 99),
      // Even though second candle goes up, stop was hit first
      candle("2026-03-02", 99, 102, 98, 101),
    ];

    const result = gradeGuess(setup, reveal, "LONG");
    expect(result.correct).toBe(false);
    expect(result.targetHit).toBe(true);
  });

  test("LONG on flat market (no target hit): wins if final close > setupClose", () => {
    // ATR=2 => threshold=1.0
    // setupClose=100, range stays within [99, 101)
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 100.8, 99.5, 100.3),
      candle("2026-03-02", 100.3, 100.9, 99.2, 100.5), // final close = 100.5 > 100
    ];

    const result = gradeGuess(setup, reveal, "LONG");
    expect(result.correct).toBe(true);
    expect(result.targetHit).toBe(false);
  });

  test("LONG on flat market (no target hit): loses if final close < setupClose", () => {
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 100.8, 99.5, 99.7),
      candle("2026-03-02", 99.7, 100.6, 99.2, 99.6), // final close = 99.6 < 100
    ];

    const result = gradeGuess(setup, reveal, "LONG");
    expect(result.correct).toBe(false);
    expect(result.targetHit).toBe(false);
  });

  test("SHORT wins when reveal goes down by more than threshold", () => {
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 100.5, 98, 99),
    ];

    const result = gradeGuess(setup, reveal, "SHORT");
    expect(result.correct).toBe(true);
    expect(result.targetHit).toBe(true);
  });

  test("SHORT loses when reveal hits upside first (stop-out)", () => {
    // ATR=2 => threshold=1.0, setupClose=100, stop=101
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      // high hits 101.5 first (before low reaches 99)
      candle("2026-03-01", 100, 101.5, 99.5, 101),
      candle("2026-03-02", 101, 102, 97, 98), // too late, stop hit first
    ];

    const result = gradeGuess(setup, reveal, "SHORT");
    expect(result.correct).toBe(false);
    expect(result.targetHit).toBe(true);
  });

  test("SHORT on flat market (no target hit): wins if final close < setupClose", () => {
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 100.5, 99.5, 99.7),
      candle("2026-03-02", 99.7, 100.3, 99.2, 99.4), // final close = 99.4 < 100
    ];

    const result = gradeGuess(setup, reveal, "SHORT");
    expect(result.correct).toBe(true);
    expect(result.targetHit).toBe(false);
  });

  test("SHORT on flat market: loses if final close > setupClose", () => {
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 100.8, 99.5, 100.3),
      candle("2026-03-02", 100.3, 100.9, 99.2, 100.5), // final close = 100.5 > 100
    ];

    const result = gradeGuess(setup, reveal, "SHORT");
    expect(result.correct).toBe(false);
    expect(result.targetHit).toBe(false);
  });

  test("PASS wins when reveal stays flat (neither direction clears threshold)", () => {
    // ATR=2 => threshold=1.0, setupClose=100
    // Reveal stays within (99, 101)
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 100.8, 99.2, 100.3),
      candle("2026-03-02", 100.3, 100.9, 99.5, 100.1),
    ];

    const result = gradeGuess(setup, reveal, "PASS");
    expect(result.correct).toBe(true);
    expect(result.targetHit).toBe(false);
  });

  test("PASS loses when reveal clears threshold upward", () => {
    // ATR=2 => threshold=1.0, setupClose=100
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 102, 99, 101), // high=102 >= 101 => breakout
    ];

    const result = gradeGuess(setup, reveal, "PASS");
    expect(result.correct).toBe(false);
    expect(result.targetHit).toBe(true);
  });

  test("PASS loses when reveal clears threshold downward", () => {
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      candle("2026-03-01", 100, 101, 98, 99), // low=98 <= 99 => breakout
    ];

    const result = gradeGuess(setup, reveal, "PASS");
    expect(result.correct).toBe(false);
    expect(result.targetHit).toBe(true);
  });

  test("uses 0.5 * ATR as threshold (not 2.5)", () => {
    // ATR = 10 => threshold should be 5 (0.5 * 10), NOT 25 (2.5 * 10)
    // setupClose = 100, so LONG target = 105
    const setup = makeSetupWithATR(10, 100);
    const reveal: OHLCV[] = [
      // high = 104 < 105, so if threshold were 0.5*ATR, no hit
      // but if threshold were 2.5*ATR=25, target=125, also no hit
      candle("2026-03-01", 100, 104, 97, 103),
      // high = 106 >= 105, so LONG wins with 0.5*ATR threshold
      candle("2026-03-02", 103, 106, 102, 105),
    ];

    const result = gradeGuess(setup, reveal, "LONG");
    expect(result.correct).toBe(true);
    expect(result.targetHit).toBe(true);
  });

  test("returns incorrect for LONG when both directions trigger (stop-out on LONG)", () => {
    // If both upside and downside trigger on the same candle, LONG loses
    // ATR=2 => threshold=1.0, setupClose=100
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [
      // low=98 (<= 99) triggers stop, high=102 (>= 101) triggers target
      // For LONG: check target first, then stop. If both, it's a LOSS (stopped out).
      candle("2026-03-01", 100, 102, 98, 100),
    ];

    const result = gradeGuess(setup, reveal, "LONG");
    // Per spec: "If both directions trigger, it's a LOSS (the user got stopped out)"
    expect(result.correct).toBe(false);
    expect(result.targetHit).toBe(true);
  });

  test("empty reveal array: LONG loses (no target hit, no final close to compare)", () => {
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [];

    const result = gradeGuess(setup, reveal, "LONG");
    // No reveal candles => no target hit, no final close => incorrect
    expect(result.correct).toBe(false);
    expect(result.targetHit).toBe(false);
  });

  test("PASS with empty reveal: wins (flat market vacuously)", () => {
    const setup = makeSetupWithATR(2, 100);
    const reveal: OHLCV[] = [];

    const result = gradeGuess(setup, reveal, "PASS");
    expect(result.correct).toBe(true);
    expect(result.targetHit).toBe(false);
  });
});
