import { describe, it, expect } from "vitest";
import { updateStats, type DojoStats } from "./dojoStats";

const initialStats: DojoStats = {
  accuracy: { correct: 0, total: 0 },
  selectivity: { passCount: 0, total: 0 },
};

describe("updateStats", () => {
  it("initial state has all counters at 0", () => {
    expect(initialStats.accuracy.correct).toBe(0);
    expect(initialStats.accuracy.total).toBe(0);
    expect(initialStats.selectivity.passCount).toBe(0);
    expect(initialStats.selectivity.total).toBe(0);
  });

  it("LONG_WIN increments accuracy but not selectivity passCount", () => {
    const result = updateStats(initialStats, "LONG_WIN");
    expect(result.accuracy).toEqual({ correct: 1, total: 1 });
    expect(result.selectivity).toEqual({ passCount: 0, total: 1 });
  });

  it("PASS_CORRECT increments both accuracy and selectivity", () => {
    const result = updateStats(initialStats, "PASS_CORRECT");
    expect(result.accuracy).toEqual({ correct: 1, total: 1 });
    expect(result.selectivity).toEqual({ passCount: 1, total: 1 });
  });

  it("cumulative: 2 wins + 1 pass + SHORT_LOSS gives accuracy 2/4, selectivity 1/4", () => {
    const base: DojoStats = {
      accuracy: { correct: 2, total: 3 },
      selectivity: { passCount: 1, total: 3 },
    };
    const result = updateStats(base, "SHORT_LOSS");
    expect(result.accuracy).toEqual({ correct: 2, total: 4 });
    expect(result.selectivity).toEqual({ passCount: 1, total: 4 });
  });

  it("PASS_INCORRECT increments accuracy total but NOT passCount", () => {
    const base: DojoStats = {
      accuracy: { correct: 1, total: 2 },
      selectivity: { passCount: 1, total: 2 },
    };
    const result = updateStats(base, "PASS_INCORRECT");
    expect(result.accuracy).toEqual({ correct: 1, total: 3 });
    expect(result.selectivity).toEqual({ passCount: 1, total: 3 });
  });

  it("returns a new object (immutable) and does not mutate input", () => {
    const result = updateStats(initialStats, "LONG_WIN");
    expect(result).not.toBe(initialStats);
    expect(result.accuracy).not.toBe(initialStats.accuracy);
    expect(result.selectivity).not.toBe(initialStats.selectivity);
    // Original unchanged
    expect(initialStats.accuracy).toEqual({ correct: 0, total: 0 });
    expect(initialStats.selectivity).toEqual({ passCount: 0, total: 0 });
  });

  it("LONG_LOSS is incorrect direction call", () => {
    const result = updateStats(initialStats, "LONG_LOSS");
    expect(result.accuracy).toEqual({ correct: 0, total: 1 });
    expect(result.selectivity).toEqual({ passCount: 0, total: 1 });
  });

  it("SHORT_WIN is correct direction call", () => {
    const result = updateStats(initialStats, "SHORT_WIN");
    expect(result.accuracy).toEqual({ correct: 1, total: 1 });
    expect(result.selectivity).toEqual({ passCount: 0, total: 1 });
  });
});
