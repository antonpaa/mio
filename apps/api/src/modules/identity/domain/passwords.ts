import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id at OWASP parameters (docs/architecture/authentication.md):
 * m=19456 KiB, t=2, p=1 as the floor. NIST 800-63B policy: length + a
 * screened denylist, NO composition rules, NO rotation.
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

/** Small local screen; a fuller list ships with WP-30 hardening. */
const COMMON_PASSWORDS = new Set([
  'password1234',
  'salasana12345',
  'qwertyuiop12',
  '123456789012',
  'letmeinplease',
  'passw0rd1234',
  'adminadmin12',
  'welcome12345',
]);

export interface PasswordPolicyInput {
  password: string;
  /** Lowercased fragments that must not appear: names, birth year, email local part. */
  forbiddenFragments?: readonly string[];
}

export function passwordPolicyError(input: PasswordPolicyInput): string | null {
  const password = input.password;
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'That password is too common - pick something more personal to you.';
  }
  const lowered = password.toLowerCase();
  for (const fragment of input.forbiddenFragments ?? []) {
    if (fragment.length >= 4 && lowered.includes(fragment)) {
      return 'Your password must not contain your name or birth date.';
    }
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * A real hash of a nonsense value, verified against unknown accounts so the
 * work factor is identical whether or not the email exists - the
 * enumeration-timing defence the spec demands.
 */
let dummyHashPromise: Promise<string> | undefined;
export async function burnEqualWork(password: string): Promise<void> {
  dummyHashPromise ??= hashPassword('correct-horse-battery-staple-decoy');
  await verifyPassword(await dummyHashPromise, password);
}
