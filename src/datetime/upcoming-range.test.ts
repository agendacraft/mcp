import dayjs from "dayjs";
import "dayjs/locale/en-gb";
import { getUpcomingRangeEnd } from "./upcoming-range";

describe("upcoming calendar boundary", () => {
  it.each([
    ["2026-01-18", "2026-01-31"],
    ["2026-01-19", "2026-01-31"],
    ["2026-01-20", "2026-01-31"],
    ["2026-01-21", "2026-01-31"],
    ["2026-01-22", "2026-01-31"],
    ["2026-01-23", "2026-01-31"],
    ["2026-01-24", "2026-01-31"],
    ["2026-12-31", "2027-01-09"],
    ["2028-02-27", "2028-03-11"],
    ["2026-03-08", "2026-03-21"],
    ["2026-11-01", "2026-11-14"],
  ])("ends next week on %s at %s", (today, end) => {
    const result = getUpcomingRangeEnd(today);

    expect(result).toBe(end);
  });

  it("keeps Sunday-anchored weeks with a Monday-start locale", () => {
    const original = dayjs.locale();
    dayjs.locale("en-gb");

    try {
      const result = getUpcomingRangeEnd("2026-01-21");

      expect(result).toBe("2026-01-31");
    } finally {
      dayjs.locale(original);
    }
  });
});
