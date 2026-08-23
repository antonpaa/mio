import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_POLICY, type SessionRealm } from '../domain/session-ids.js';

export function readSessionCookie(request: FastifyRequest, realm: SessionRealm): string {
  const header = request.headers.cookie ?? '';
  const name = SESSION_POLICY[realm].cookie;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function setSessionCookie(
  reply: FastifyReply,
  realm: SessionRealm,
  sessionId: string,
  secure: boolean,
): void {
  const name = SESSION_POLICY[realm].cookie;
  reply.header(
    'set-cookie',
    `${name}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  );
}

export function clearSessionCookie(
  reply: FastifyReply,
  realm: SessionRealm,
  secure: boolean,
): void {
  const name = SESSION_POLICY[realm].cookie;
  reply.header(
    'set-cookie',
    `${name}=; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`,
  );
}
