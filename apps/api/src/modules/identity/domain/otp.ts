import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Email OTP mechanics: 6 CSPRNG digits, stored as HMAC-SHA256 under a
 * dedicated pepper, 10-minute TTL, five attempts, single-use. Verification
 * compares in constant time.
 */

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(code: string, pepper: string, challengeId: string): string {
  return createHmac('sha256', pepper).update(`${challengeId}:${code}`).digest('hex');
}

export function otpMatches(
  expectedHash: string,
  code: string,
  pepper: string,
  challengeId: string,
): boolean {
  const actual = Buffer.from(hashOtp(code, pepper, challengeId), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
