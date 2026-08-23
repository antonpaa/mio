/**
 * Progressive delay, never hard lockout (docs/architecture/authentication.md):
 * a fixed lockout is a denial-of-service lever against clinicians. Delay
 * doubles from the 4th consecutive failure, capped at 15 minutes.
 */

export const DELAY_START_AT_FAILURE = 4;
export const DELAY_CAP_SECONDS = 900;

export function delaySecondsFor(failedCount: number): number {
  if (failedCount < DELAY_START_AT_FAILURE) return 0;
  return Math.min(DELAY_CAP_SECONDS, 2 ** (failedCount - DELAY_START_AT_FAILURE + 1));
}
