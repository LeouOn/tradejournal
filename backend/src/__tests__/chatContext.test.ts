import { buildContextSections, type ContextFlags } from "../services/aiRouter";

describe("buildContextSections", () => {
  const mockStatsText = "Win Rate: 60%\nProfit Factor: 1.5";
  const mockNotesContext = "--- Match #1 ---\nTrade: NQ, P&L: +$200";
  const mockRecentTrades = "Recent Trade 1: NQ +$200\nRecent Trade 2: ES -$100";
  const mockPlaybookRules = "Playbook: Breakout setup\nRules: Enter on momentum";

  const defaultFlags: ContextFlags = {
    recentTrades: true,
    performanceStats: true,
    playbookRules: true,
  };

  it("includes all sections when all flags are true", () => {
    const result = buildContextSections(
      mockStatsText,
      mockNotesContext,
      mockRecentTrades,
      mockPlaybookRules,
      defaultFlags
    );

    expect(result).toContain("Below is the trader's statistics");
    expect(result).toContain(mockStatsText);
    expect(result).toContain("most semantically relevant historical journal entries");
    expect(result).toContain(mockNotesContext);
    expect(result).toContain("Recent Trades Context");
    expect(result).toContain(mockRecentTrades);
    expect(result).toContain("Playbook Rules");
    expect(result).toContain(mockPlaybookRules);
  });

  it("excludes stats when performanceStats is false", () => {
    const flags: ContextFlags = { ...defaultFlags, performanceStats: false };
    const result = buildContextSections(
      mockStatsText,
      mockNotesContext,
      mockRecentTrades,
      mockPlaybookRules,
      flags
    );

    expect(result).not.toContain("Below is the trader's statistics");
    expect(result).not.toContain(mockStatsText);
    expect(result).toContain("Recent Trades Context");
    expect(result).toContain("Playbook Rules");
  });

  it("excludes recent trades when recentTrades is false", () => {
    const flags: ContextFlags = { ...defaultFlags, recentTrades: false };
    const result = buildContextSections(
      mockStatsText,
      mockNotesContext,
      "",
      mockPlaybookRules,
      flags
    );

    expect(result).not.toContain("Recent Trades Context");
    expect(result).toContain("Below is the trader's statistics");
    expect(result).toContain("Playbook Rules");
  });

  it("excludes playbook rules when playbookRules is false", () => {
    const flags: ContextFlags = { ...defaultFlags, playbookRules: false };
    const result = buildContextSections(
      mockStatsText,
      mockNotesContext,
      mockRecentTrades,
      "",
      flags
    );

    expect(result).not.toContain("Playbook Rules");
    expect(result).toContain("Below is the trader's statistics");
    expect(result).toContain("Recent Trades Context");
  });

  it("excludes all optional sections when all flags are false", () => {
    const flags: ContextFlags = {
      recentTrades: false,
      performanceStats: false,
      playbookRules: false,
    };
    const result = buildContextSections(
      mockStatsText,
      mockNotesContext,
      mockRecentTrades,
      mockPlaybookRules,
      flags
    );

    expect(result).not.toContain("Below is the trader's statistics");
    expect(result).not.toContain("Recent Trades Context");
    expect(result).not.toContain("Playbook Rules");
    // Should still have the journal notes context (always included)
    expect(result).toContain("most semantically relevant historical journal entries");
  });

  it("skips recent trades section when content is empty even if flag is true", () => {
    const result = buildContextSections(
      mockStatsText,
      mockNotesContext,
      "",
      mockPlaybookRules,
      defaultFlags
    );

    expect(result).not.toContain("Recent Trades Context");
  });

  it("skips playbook rules section when content is empty even if flag is true", () => {
    const result = buildContextSections(
      mockStatsText,
      mockNotesContext,
      mockRecentTrades,
      "",
      defaultFlags
    );

    expect(result).not.toContain("Playbook Rules");
  });

  it("always includes journal notes context regardless of flags", () => {
    const flags: ContextFlags = {
      recentTrades: false,
      performanceStats: false,
      playbookRules: false,
    };
    const result = buildContextSections(
      mockStatsText,
      mockNotesContext,
      "",
      "",
      flags
    );

    expect(result).toContain("most semantically relevant historical journal entries");
    expect(result).toContain(mockNotesContext);
  });
});
