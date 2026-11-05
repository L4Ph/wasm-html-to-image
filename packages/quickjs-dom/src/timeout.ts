/** Upper bound for one call into the page, in ms, when the caller gives none. */
export const DEFAULT_TIMEOUT = 10000;

/**
 * Settle a `timeout` option. An absent value takes `fallback` (the default 10000). `0` and `Infinity` both mean
 * "no limit" and become `Infinity`; a negative or `NaN` value is refused, since it could only interrupt at once.
 *
 * The engine has a single representation of "no limit" (a QuickJS deadline of 0, no `AbortSignal.timeout`, no
 * race timer), so every entry point (page, bridge, jsdom, vitest, jest, createDOM) settles its option here.
 */
export function normalizeTimeout(value: number | undefined, fallback = DEFAULT_TIMEOUT): number {
  const ms = value ?? fallback;
  if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
    throw new RangeError(`timeout must be a non-negative number of milliseconds (0 or Infinity for no limit), got ${String(ms)}`);
  }
  // -0 is 0; a positive Infinity stays Infinity and a fractional value is left as it is
  return ms === 0 || ms === Infinity ? Infinity : ms;
}
