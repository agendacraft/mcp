import { addDays, formatLocalDate, parseLocalDate } from "./local-date";

describe("local-date helpers", () => {
  describe("formatLocalDate", () => {
    it("formats a local date as YYYY-MM-DD", () => {
      const date = new Date(2026, 0, 5);
      expect(formatLocalDate(date)).toBe("2026-01-05");
    });

    it("pads single-digit month and day", () => {
      const date = new Date(2026, 8, 9);
      expect(formatLocalDate(date)).toBe("2026-09-09");
    });
  });

  describe("parseLocalDate", () => {
    it("parses YYYY-MM-DD as a local date (midnight local)", () => {
      const parsed = parseLocalDate("2026-03-14");
      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(2);
      expect(parsed.getDate()).toBe(14);
      expect(parsed.getHours()).toBe(0);
    });

    it("round-trips through formatLocalDate", () => {
      const original = "2026-11-30";
      expect(formatLocalDate(parseLocalDate(original))).toBe(original);
    });

    it.each([
      { label: "non-date string", input: "not-a-date", expected: /Invalid date format/ },
      { label: "missing zero-padding", input: "2026-2-3", expected: /Invalid date format/ },
      { label: "out-of-range month", input: "2026-13-01", expected: /Invalid calendar date/ },
      { label: "out-of-range day", input: "2026-02-30", expected: /Invalid calendar date/ },
      { label: "empty string", input: "", expected: /Invalid date format/ },
    ])("rejects a $label", ({ input, expected }) => {
      expect(() => parseLocalDate(input)).toThrow(expected);
    });
  });

  describe("addDays", () => {
    it.each([
      { label: "positive days", from: "2026-01-15", delta: 3, expected: "2026-01-18" },
      { label: "negative days", from: "2026-01-15", delta: -1, expected: "2026-01-14" },
      { label: "month rollover", from: "2026-01-31", delta: 1, expected: "2026-02-01" },
      { label: "year rollover", from: "2025-12-31", delta: 1, expected: "2026-01-01" },
      { label: "crossing into leap day", from: "2028-02-28", delta: 1, expected: "2028-02-29" },
      { label: "crossing out of leap day", from: "2028-02-29", delta: 1, expected: "2028-03-01" },
    ])("handles $label ($from + $delta → $expected)", ({ from, delta, expected }) => {
      expect(addDays(from, delta)).toBe(expected);
    });
  });
});
