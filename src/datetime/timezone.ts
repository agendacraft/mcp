const LEGACY_TIMEZONE_ALIASES: Record<string, string> = {
  "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver",
  "US/Pacific": "America/Los_Angeles",
  "US/Alaska": "America/Anchorage",
  "US/Hawaii": "Pacific/Honolulu",
  "US/Arizona": "America/Phoenix",
};

/**
 * Trims a timezone identifier and maps supported legacy aliases to canonical IANA names.
 */
export function normalizeTimezone(timezoneName: string): string {
  const trimmed = timezoneName.trim();
  return LEGACY_TIMEZONE_ALIASES[trimmed] ?? trimmed;
}

/**
 * Returns whether a timezone identifier is valid in the current runtime's `Intl` data.
 */
export function isValidTimezone(timezoneName: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezoneName }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the runtime timezone, normalizes legacy aliases, and falls back to `"UTC"` when
 * detection fails or returns an invalid timezone.
 */
export function detectRuntimeTimezone(): string {
  try {
    const timezoneName = normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    return isValidTimezone(timezoneName) ? timezoneName : "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Resolves the effective timezone from a user setting first, then the runtime timezone.
 * Empty or invalid user settings fall back to `detectRuntimeTimezone()`.
 */
export function getEffectiveTimezone(userTimezone: string | null | undefined): string {
  const trimmed = userTimezone?.trim();
  const candidate = trimmed ? normalizeTimezone(trimmed) : detectRuntimeTimezone();

  if (isValidTimezone(candidate)) {
    return candidate;
  }

  return detectRuntimeTimezone();
}
