import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** Structural slices of fastify's request/reply/instance - typed here
 * rather than imported, because Nest pins its own fastify version and
 * the two FastifyInstance types refuse each other on a method they do
 * not even use. The runtime objects satisfy these shapes either way. */
interface HardeningRequest {
  url: string;
  method: string;
  ip: string;
}
interface HardeningReply {
  hasHeader(name: string): boolean;
  header(name: string, value: string | number): unknown;
  code(status: number): HardeningReply;
  send(payload?: unknown): unknown;
  callNotFound(): unknown;
}
interface HardeningInstance {
  addHook(
    name: 'onRequest',
    hook: (request: HardeningRequest, reply: HardeningReply) => Promise<void>,
  ): unknown;
  addHook(
    name: 'onSend',
    hook: (request: HardeningRequest, reply: HardeningReply, payload: unknown) => Promise<unknown>,
  ): unknown;
  get(
    path: string,
    handler: (request: HardeningRequest, reply: HardeningReply) => unknown,
  ): unknown;
}

/**
 * WP-30: the HTTP hardening layer, hand-rolled per ADR-0009 - every
 * piece is twenty-something lines the platform already almost gives us,
 * and none of it deserves a dependency.
 *
 * - SECURITY HEADERS on every response, set only where a route has not
 *   already chosen stricter ones (the attachment route's sandbox CSP
 *   must win).
 * - AUTH RATE LIMIT: a per-IP fixed window over the credential surface
 *   (/api/x/auth/y - login, verify, resend, invite, forgot, reset). The
 *   per-ACCOUNT progressive delay (authentication.md) stays the primary
 *   brake; this window is the coarse per-SOURCE backstop it never was.
 *   In-memory by design: multi-instance deployments get a per-instance
 *   window, which still bounds any single connection's abuse.
 * - SPA SERVING: the built web app from the API origin, because the
 *   session cookie is same-origin by design. Assets are immutable,
 *   index.html is never cached, and anything outside /api falls back to
 *   the app shell for client-side routing.
 */

const BASE_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

/** The SPA needs itself, its hashed assets and data/blob images (WP-24
 * attachment previews render from same-origin URLs; composer thumbnails
 * use blob:). Styles allow inline because React Aria positions overlays
 * with style attributes. */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function registerSecurityHeaders(
  fastify: HardeningInstance,
  options: { hsts: boolean },
): void {
  fastify.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(BASE_HEADERS)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    if (!reply.hasHeader('content-security-policy')) {
      reply.header('content-security-policy', APP_CSP);
    }
    if (options.hsts && !reply.hasHeader('strict-transport-security')) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });
}

const AUTH_SURFACE = /^\/api\/(patient|staff)\/auth\//;

export function registerAuthRateLimit(
  fastify: HardeningInstance,
  options: { limit: number; windowMs: number },
): void {
  const windows = new Map<string, { count: number; resetAt: number }>();
  fastify.addHook('onRequest', async (request, reply) => {
    if (!AUTH_SURFACE.test(request.url)) return;
    const now = Date.now();
    // lazy purge keeps the map bounded without a timer to leak
    if (windows.size > 10_000) {
      for (const [key, value] of windows) {
        if (value.resetAt <= now) windows.delete(key);
      }
    }
    const key = request.ip;
    const window = windows.get(key);
    if (!window || window.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + options.windowMs });
      return;
    }
    window.count += 1;
    if (window.count > options.limit) {
      reply.header('retry-after', Math.ceil((window.resetAt - now) / 1000));
      await reply.code(429).send({ status: 'rate_limited' });
    }
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** A real wildcard route (static routes always win in fastify's radix
 * tree, so /api and /health keep their handlers). Unknown /api paths
 * are handed back to the not-found handler Nest owns. */
export function registerSpaServing(fastify: HardeningInstance, distDir: string): void {
  const root = resolve(distDir);
  const sendFile = (reply: HardeningReply, filePath: string, cacheControl: string): unknown => {
    reply.header('content-type', MIME[extname(filePath)] ?? 'application/octet-stream');
    reply.header('cache-control', cacheControl);
    return reply.send(createReadStream(filePath));
  };
  fastify.get('/*', (request, reply) => {
    const url = request.url.split('?')[0] ?? '/';
    if (url.startsWith('/api') || url.startsWith('/health')) {
      return reply.callNotFound();
    }
    const candidate = normalize(join(root, url));
    // the same path-escape guard the fs storage adapter applies
    if (candidate !== root && candidate.startsWith(root + sep)) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        const immutable = url.startsWith('/assets/');
        return sendFile(
          reply,
          candidate,
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      }
    }
    // client-side routes land on the shell; the router takes it from here
    return sendFile(reply, join(root, 'index.html'), 'no-cache');
  });
}
