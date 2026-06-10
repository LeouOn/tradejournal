import { describe, it, expect } from "vitest";
import {
  type ContextFlags,
  defaultContextFlags,
  serializeContextFlags,
  deserializeContextFlags,
} from "./contextFlags";

describe("defaultContextFlags", () => {
  it("returns all flags enabled by default", () => {
    const flags = defaultContextFlags();
    expect(flags.recentTrades).toBe(true);
    expect(flags.performanceStats).toBe(true);
    expect(flags.playbookRules).toBe(true);
  });
});

describe("serializeContextFlags / deserializeContextFlags", () => {
  it("round-trips default flags", () => {
    const flags = defaultContextFlags();
    const serialized = serializeContextFlags(flags);
    const deserialized = deserializeContextFlags(serialized);
    expect(deserialized).toEqual(flags);
  });

  it("round-trips all-off flags", () => {
    const flags: ContextFlags = {
      recentTrades: false,
      performanceStats: false,
      playbookRules: false,
    };
    const serialized = serializeContextFlags(flags);
    const deserialized = deserializeContextFlags(serialized);
    expect(deserialized).toEqual(flags);
  });

  it("round-trips mixed flags", () => {
    const flags: ContextFlags = {
      recentTrades: true,
      performanceStats: false,
      playbookRules: true,
    };
    const serialized = serializeContextFlags(flags);
    const deserialized = deserializeContextFlags(serialized);
    expect(deserialized).toEqual(flags);
  });

  it("deserialize handles null gracefully", () => {
    const result = deserializeContextFlags(null);
    expect(result).toEqual(defaultContextFlags());
  });

  it("deserialize handles partial data by falling back to defaults", () => {
    const partial = JSON.stringify({ recentTrades: false });
    const result = deserializeContextFlags(partial);
    expect(result.recentTrades).toBe(false);
    expect(result.performanceStats).toBe(true);
    expect(result.playbookRules).toBe(true);
  });

  it("serialize returns a valid JSON string", () => {
    const flags = defaultContextFlags();
    const serialized = serializeContextFlags(flags);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});
