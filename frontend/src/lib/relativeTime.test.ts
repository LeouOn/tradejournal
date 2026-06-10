import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relativeTime";

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("returns 'just now' for less than 60 seconds", () => {
    const date = new Date("2026-06-10T11:59:30Z");
    expect(formatRelativeTime(date, now)).toBe("just now");
  });

  it("returns minutes ago for < 60 min", () => {
    const date = new Date("2026-06-10T11:30:00Z");
    expect(formatRelativeTime(date, now)).toBe("30m ago");
  });

  it("returns '1m ago' for 1 minute", () => {
    const date = new Date("2026-06-10T11:59:00Z");
    expect(formatRelativeTime(date, now)).toBe("1m ago");
  });

  it("returns hours ago for < 24h", () => {
    const date = new Date("2026-06-10T10:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("2h ago");
  });

  it("returns '1h ago' for 1 hour", () => {
    const date = new Date("2026-06-10T11:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("1h ago");
  });

  it("returns 'Yesterday' for 1 day ago", () => {
    const date = new Date("2026-06-09T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("Yesterday");
  });

  it("returns '2d ago' for 2 days ago", () => {
    const date = new Date("2026-06-08T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("2d ago");
  });

  it("returns weeks ago for >= 7 days", () => {
    const date = new Date("2026-06-03T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("1w ago");
  });

  it("returns '5w ago' for 35 days ago", () => {
    const date = new Date("2026-05-06T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("5w ago");
  });

  it("returns full date for > 1 year", () => {
    const date = new Date("2025-03-15T08:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("Mar 15, 2025");
  });

  it("handles string input", () => {
    expect(formatRelativeTime("2026-06-10T11:30:00Z", now)).toBe("30m ago");
  });

  it("uses current Date when now is not provided", () => {
    // Just verify it doesn't throw and returns a string
    const result = formatRelativeTime(new Date());
    expect(typeof result).toBe("string");
  });

  it("returns '3d ago' for 3 days ago", () => {
    const date = new Date("2026-06-07T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("3d ago");
  });

  it("returns '6d ago' for 6 days ago (just under 1 week)", () => {
    const date = new Date("2026-06-04T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("6d ago");
  });

  it("returns '2w ago' for 14 days ago", () => {
    const date = new Date("2026-05-27T12:00:00Z");
    expect(formatRelativeTime(date, now)).toBe("2w ago");
  });
});
