import { randomBytes } from 'node:crypto';

/** 256-bit opaque session ids - never sequential, never meaningful. */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export const SESSION_POLICY = {
  patient: { idleMinutes: 30, absoluteHours: 12, cookie: 'mio_patient_session' },
  staff: { idleMinutes: 15, absoluteHours: 12, cookie: 'mio_staff_session' },
} as const;

export type SessionRealm = keyof typeof SESSION_POLICY;
