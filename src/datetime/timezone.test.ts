import type { Mock } from "vitest";

import {
  detectRuntimeTimezone,
  getEffectiveTimezone,
  isValidTimezone,
  normalizeTimezone,
} from "./timezone";

function mockIntlWithTimezone(timezone: string): Mock {
  return vi.fn().mockImplementation((_locale?: unknown, options?: { timeZone?: string }) => {
    if (options?.timeZone?.startsWith("Invalid/")) {
      throw new RangeError("Invalid time zone specified");
    }

    return {
      resolvedOptions: () => ({ timeZone: timezone }),
      format: () => "",
    };
  });
}

describe("timezone helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["US/Eastern", "America/New_York"],
    ["US/Pacific", "America/Los_Angeles"],
    ["US/Central", "America/Chicago"],
    ["US/Mountain", "America/Denver"],
    ["US/Alaska", "America/Anchorage"],
    ["US/Hawaii", "Pacific/Honolulu"],
    ["US/Arizona", "America/Phoenix"],
  ])("normalizes legacy %s timezone alias to %s", (legacy, canonical) => {
    expect(normalizeTimezone(legacy)).toBe(canonical);
  });

  it("detects the runtime timezone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(mockIntlWithTimezone("US/Eastern"));

    expect(detectRuntimeTimezone()).toBe("America/New_York");
  });

  it("returns UTC when runtime timezone detection fails", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("Intl not supported");
    });

    expect(detectRuntimeTimezone()).toBe("UTC");
  });

  it("returns UTC when runtime timezone detection returns an invalid timezone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(mockIntlWithTimezone("Invalid/Runtime"));

    expect(detectRuntimeTimezone()).toBe("UTC");
  });

  it("uses valid user timezone before runtime timezone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      mockIntlWithTimezone("America/Los_Angeles")
    );

    expect(getEffectiveTimezone("Europe/London")).toBe("Europe/London");
  });

  it("falls back to runtime timezone for missing or invalid user timezone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      mockIntlWithTimezone("America/Los_Angeles")
    );

    expect(getEffectiveTimezone("")).toBe("America/Los_Angeles");
    expect(getEffectiveTimezone(null)).toBe("America/Los_Angeles");
    expect(getEffectiveTimezone("Invalid/Timezone")).toBe("America/Los_Angeles");
  });

  it("validates timezone names", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Invalid/Timezone")).toBe(false);
  });
});
