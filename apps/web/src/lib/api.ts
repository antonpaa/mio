/**
 * The auth API client. One login screen serves both realms (the design's
 * shared login): the client asks the patient realm first, then staff -
 * whichever accepts carries the flow, and the realm sticks for the rest
 * of the session.
 */

export type Realm = 'patient' | 'staff';

export interface SessionAccount {
  id: string;
  givenName: string;
  familyName: string;
  locale: 'en' | 'fi' | 'sv';
  role?: string;
}

export type LoginOutcome =
  | { status: 'otp_sent'; realm: Realm; challengeId: string }
  | { status: 'delayed'; retryAfterSeconds: number }
  | { status: 'invalid' };

async function post(url: string, body: object): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
}

export async function login(email: string, password: string): Promise<LoginOutcome> {
  for (const realm of ['patient', 'staff'] as const) {
    const response = await post(`/api/${realm}/auth/login`, { email, password });
    if (response.ok) {
      const data = (await response.json()) as { challengeId: string };
      return { status: 'otp_sent', realm, challengeId: data.challengeId };
    }
    if (response.status === 401) {
      const data = (await response.json().catch(() => ({}))) as {
        status?: string;
        retryAfterSeconds?: number;
      };
      if (data.status === 'delayed') {
        return { status: 'delayed', retryAfterSeconds: data.retryAfterSeconds ?? 60 };
      }
    }
  }
  return { status: 'invalid' };
}

export async function verifyOtp(
  realm: Realm,
  challengeId: string,
  code: string,
): Promise<{ status: 'signed_in'; account: SessionAccount } | { status: 'invalid' | 'expired' }> {
  const response = await post(`/api/${realm}/auth/verify`, { challengeId, code });
  if (response.ok) {
    const data = (await response.json()) as { account: SessionAccount };
    return { status: 'signed_in', account: data.account };
  }
  const data = (await response.json().catch(() => ({}))) as { status?: string };
  return { status: data.status === 'expired' ? 'expired' : 'invalid' };
}

export async function resendOtp(realm: Realm, challengeId: string): Promise<void> {
  await post(`/api/${realm}/auth/resend`, { challengeId });
}

export async function whoami(): Promise<{ realm: Realm; account: SessionAccount } | null> {
  for (const realm of ['patient', 'staff'] as const) {
    const response = await fetch(`/api/${realm}/auth/session`, { credentials: 'same-origin' });
    if (response.ok) {
      const data = (await response.json()) as { account: SessionAccount };
      return { realm, account: data.account };
    }
  }
  return null;
}

export async function logout(realm: Realm): Promise<void> {
  await post(`/api/${realm}/auth/logout`, {});
}

export async function inspectInvite(
  realm: Realm,
  token: string,
): Promise<{ status: 'ok'; givenName: string; email: string } | { status: 'invalid' }> {
  const response = await fetch(`/api/${realm}/auth/invite/${token}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) return { status: 'invalid' };
  return (await response.json()) as { status: 'ok'; givenName: string; email: string };
}

export async function acceptInvite(
  realm: Realm,
  token: string,
  password: string,
): Promise<
  | { status: 'otp_sent'; challengeId: string }
  | { status: 'policy'; message: string }
  | { status: 'invalid' }
> {
  const response = await post(`/api/${realm}/auth/invite/accept`, {
    token,
    password,
    acceptTerms: true,
  });
  const data = (await response.json().catch(() => ({}))) as {
    status?: string;
    challengeId?: string;
    message?: string;
  };
  if (response.ok && data.challengeId) return { status: 'otp_sent', challengeId: data.challengeId };
  if (data.status === 'policy') return { status: 'policy', message: data.message ?? '' };
  return { status: 'invalid' };
}

export async function requestReset(email: string): Promise<void> {
  // Both realms get the request; responses are uniform by design.
  await post('/api/patient/auth/forgot', { email });
  await post('/api/staff/auth/forgot', { email });
}

export async function completeReset(
  realm: Realm,
  token: string,
  password: string,
): Promise<{ status: 'ok' } | { status: 'policy'; message: string } | { status: 'invalid' }> {
  const response = await post(`/api/${realm}/auth/reset`, { token, password });
  const data = (await response.json().catch(() => ({}))) as { status?: string; message?: string };
  if (response.ok) return { status: 'ok' };
  if (data.status === 'policy') return { status: 'policy', message: data.message ?? '' };
  return { status: 'invalid' };
}
