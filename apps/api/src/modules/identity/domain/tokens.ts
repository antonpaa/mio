import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Invite and reset tokens: 256-bit random, stored as SHA-256 (that entropy
 * needs no pepper), single-use, short-TTL, bound to one account.
 */

export const INVITE_TTL_DAYS = 7;
export const RESET_TTL_MINUTES = 60;

export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function linkTokenMatches(expectedHash: string, token: string): boolean {
  const actual = Buffer.from(hashLinkToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
