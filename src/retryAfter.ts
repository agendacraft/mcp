/** Interpret Retry-After as delta-seconds or an HTTP date before applying the caller's cap. */
export function parseRetryAfterMs(value: string | null, fallbackMs: number, nowMs: number): number {
  if (value === null || value.trim() === "") return fallbackMs;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : fallbackMs;
  }
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(0, deadline - nowMs) : fallbackMs;
}
