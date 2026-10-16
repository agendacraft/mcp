/**
 * Primitive helpers for working with local-timezone YYYY-MM-DD date strings.
 *
 * `new Date("2024-01-15")` parses as midnight UTC, which is the previous day
 * in negative-offset timezones. Going through these helpers keeps date math
 * anchored to the user's local calendar day.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseLocalDate(dateString: string): Date {
  const match = ISO_DATE_RE.exec(dateString);
  if (!match) {
    throw new Error(`Invalid date format: "${dateString}". Expected YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`Invalid calendar date: "${dateString}".`);
  }

  return parsed;
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateString: string, days: number): string {
  const date = parseLocalDate(dateString);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}
