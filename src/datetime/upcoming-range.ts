import { addDays, parseLocalDate } from "./local-date";

function daysToEndOfWeek(today: string): number {
  const dayOfWeek = parseLocalDate(today).getDay(); // 0 = Sunday, 6 = Saturday
  return 6 - dayOfWeek;
}

/** Return the Saturday at the end of next week, using Sunday-anchored weeks. */
export function getUpcomingRangeEnd(today: string): string {
  return addDays(today, daysToEndOfWeek(today) + 7);
}
