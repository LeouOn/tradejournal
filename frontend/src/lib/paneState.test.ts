import { describe, it, expect } from "vitest";
import { clampSplitPercent, getInitialViewMode, getInitialSplitPercent } from "./paneState";

describe("clampSplitPercent", () => {
  it("returns value when within range", () => {
    expect(clampSplitPercent(50, 20, 70)).toBe(50);
  });

  it("clamps to min when below range", () => {
    expect(clampSplitPercent(10, 20, 70)).toBe(20);
  });

  it("clamps to max when above range", () => {
    expect(clampSplitPercent(80, 20, 70)).toBe(70);
  });

  it("clamps negative values to min", () => {
    expect(clampSplitPercent(-5, 20, 70)).toBe(20);
  });

  it("handles single-value range", () => {
    expect(clampSplitPercent(50, 50, 50)).toBe(50);
  });
});

describe("getInitialViewMode", () => {
  it("returns 'split' when stored is null", () => {
    expect(getInitialViewMode(null)).toBe("split");
  });

  it("returns stored value when valid", () => {
    expect(getInitialViewMode("minimized")).toBe("minimized");
  });

  it("returns 'split' for invalid stored value", () => {
    expect(getInitialViewMode("invalid")).toBe("split");
  });

  it("accepts 'maximized'", () => {
    expect(getInitialViewMode("maximized")).toBe("maximized");
  });

  it("accepts 'split'", () => {
    expect(getInitialViewMode("split")).toBe("split");
  });
});

describe("getInitialSplitPercent", () => {
  it("returns default when stored is null", () => {
    expect(getInitialSplitPercent(null, 40)).toBe(40);
  });

  it("parses valid stored string", () => {
    expect(getInitialSplitPercent("60", 40)).toBe(60);
  });

  it("returns default for garbage string", () => {
    expect(getInitialSplitPercent("garbage", 40)).toBe(40);
  });

  it("returns default for out-of-range value", () => {
    expect(getInitialSplitPercent("150", 40)).toBe(40);
  });

  it("returns default for negative value", () => {
    expect(getInitialSplitPercent("-10", 40)).toBe(40);
  });

  it("returns default for zero", () => {
    expect(getInitialSplitPercent("0", 40)).toBe(40);
  });

  it("accepts valid boundary values", () => {
    expect(getInitialSplitPercent("20", 40)).toBe(20);
    expect(getInitialSplitPercent("80", 40)).toBe(80);
  });
});
