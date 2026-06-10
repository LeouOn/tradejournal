export interface ContextFlags {
  recentTrades: boolean;
  performanceStats: boolean;
  playbookRules: boolean;
}

export function defaultContextFlags(): ContextFlags {
  return {
    recentTrades: true,
    performanceStats: true,
    playbookRules: true,
  };
}

export function serializeContextFlags(flags: ContextFlags): string {
  return JSON.stringify(flags);
}

export function deserializeContextFlags(stored: string | null): ContextFlags {
  const defaults = defaultContextFlags();
  if (!stored) return defaults;
  try {
    const parsed = JSON.parse(stored);
    return {
      recentTrades: typeof parsed.recentTrades === "boolean" ? parsed.recentTrades : defaults.recentTrades,
      performanceStats: typeof parsed.performanceStats === "boolean" ? parsed.performanceStats : defaults.performanceStats,
      playbookRules: typeof parsed.playbookRules === "boolean" ? parsed.playbookRules : defaults.playbookRules,
    };
  } catch {
    return defaults;
  }
}
