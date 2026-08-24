import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import {
  registerAuthRateLimit,
  registerSecurityHeaders,
  registerSpaServing,
} from './shared/hardening.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // trustProxy: deployments sit behind a load balancer; the rate
    // limiter needs the caller's address, not the balancer's
    new FastifyAdapter({ bodyLimit: 8 * 1024 * 1024, trustProxy: true }),
  );
  app.enableShutdownHooks();

  const fastify = app.getHttpAdapter().getInstance();
  registerSecurityHeaders(fastify, { hsts: process.env['MIO_COOKIE_SECURE'] !== 'false' });
  registerAuthRateLimit(fastify, {
    limit: Number(process.env['MIO_AUTH_RATE_LIMIT'] ?? 30),
    windowMs: Number(process.env['MIO_AUTH_RATE_WINDOW_MS'] ?? 300_000),
  });
  // production serves the built SPA from the API origin - the session
  // cookie is same-origin by design (dev keeps the vite proxy instead)
  const webDist = process.env['MIO_WEB_DIST'];
  if (webDist) registerSpaServing(fastify, webDist);

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

void bootstrap();
