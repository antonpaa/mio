import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '@mio/db';
import { provisionTestDatabase, type TestDatabase } from '@mio/db/testing';
import { AppModule } from '../src/app.module.js';
import {
  registerAuthRateLimit,
  registerSecurityHeaders,
  registerSpaServing,
} from '../src/shared/hardening.js';

/**
 * WP-30: the hardening layer as bootstrap wires it - headers on every
 * response, a coarse per-IP window over the credential surface, and the
 * SPA served from the API origin with immutable assets and the shell
 * fallback.
 */

let db: TestDatabase;
let app: NestFastifyApplication;
let dist: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  await migrate(db.connectionString);
  process.env['MIO_DATABASE_URL'] = db.connectionString;
  process.env['MIO_OTP_PEPPER'] = 'test-pepper-not-for-production';
  process.env['MIO_COOKIE_SECURE'] = 'false';

  dist = await mkdtemp(join(tmpdir(), 'mio-dist-'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>mio</title>');
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'assets', 'app-abc123.js'), 'console.log("mio")');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  const fastify = app.getHttpAdapter().getInstance();
  registerSecurityHeaders(fastify, { hsts: true });
  registerAuthRateLimit(fastify, { limit: 3, windowMs: 60_000 });
  registerSpaServing(fastify, dist);
  await app.init();
  await fastify.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
  if (dist) await rm(dist, { recursive: true, force: true });
});

function inject(method: 'GET' | 'POST', url: string, payload?: object) {
  return app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url, ...(payload !== undefined ? { payload } : {}) });
}

describe('security headers', () => {
  it('arrive on every response, CSP and HSTS included', async () => {
    const health = await inject('GET', '/health');
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
    expect(health.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(String(health.headers['content-security-policy'])).toContain("default-src 'self'");
    expect(String(health.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(String(health.headers['strict-transport-security'])).toContain('max-age=');
  });
});

describe('auth surface rate limit', () => {
  it('closes the window after the per-IP limit, and only on the auth surface', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await inject('POST', '/api/staff/auth/login', {
        email: 'nobody@staff.example',
        password: 'wrong',
      });
      codes.push(response.statusCode);
    }
    expect(codes.slice(0, 3).every((code) => code !== 429)).toBe(true);
    expect(codes[3]).toBe(429);
    expect(codes[4]).toBe(429);

    // the window guards credentials, not the whole API
    const health = await inject('GET', '/health');
    expect(health.statusCode).toBe(200);
  });
});

describe('SPA from the API origin', () => {
  it('serves assets immutably, falls back to the shell, keeps /api as JSON 404', async () => {
    const asset = await inject('GET', '/assets/app-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(String(asset.headers['cache-control'])).toContain('immutable');
    expect(String(asset.headers['content-type'])).toContain('text/javascript');

    const route = await inject('GET', '/patients/some-client-route');
    expect(route.statusCode).toBe(200);
    expect(String(route.headers['content-type'])).toContain('text/html');
    expect(String(route.headers['cache-control'])).toBe('no-cache');
    expect(route.body).toContain('<title>mio</title>');

    // path escapes never leave the dist directory
    const escape = await inject('GET', '/assets/../../etc/passwd');
    expect(escape.statusCode).toBe(200);
    expect(escape.body).toContain('<title>mio</title>');

    const api = await inject('GET', '/api/definitely-not-a-route');
    expect(api.statusCode).toBe(404);
    expect(String(api.headers['content-type'])).toContain('application/json');
  });
});
