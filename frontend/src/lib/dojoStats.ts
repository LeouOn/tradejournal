export type GradeOutcome =
  | "LONG_WIN"
  | "LONG_LOSS"
  | "SHORT_WIN"
  | "SHORT_LOSS"
  | "PASS_CORRECT"
  | "PASS_INCORRECT";

export interface DojoStats {
  accuracy: { correct: number; total: number };
  selectivity: { passCount: number; total: number };
}

export const initialStats: DojoStats = {
  accuracy: { correct: 0, total: 0 },
  selectivity: { passCount: 0, total: 0 },
};

/**
 * Pure function: given current stats and an outcome, return new stats.
 * Immutable — always returns a new object.
 */
export function updateStats(
  current: DojoStats,
  outcome: GradeOutcome
): DojoStats {
  const isCorrect =
    outcome === "LONG_WIN" ||
    outcome === "SHORT_WIN" ||
    outcome === "PASS_CORRECT";

  const isPass =
    outcome === "PASS_CORRECT";

  return {
    accuracy: {
      correct: current.accuracy.correct + (isCorrect ? 1 : 0),
      total: current.accuracy.total + 1,
    },
    selectivity: {
      passCount: current.selectivity.passCount + (isPass ? 1 : 0),
      total: current.selectivity.total + 1,
    },
  };
}
