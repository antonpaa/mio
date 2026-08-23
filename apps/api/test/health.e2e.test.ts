import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HEALTH_PATH } from '@mio/contracts';
import { AppModule } from '../src/app.module.js';

describe('GET /health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers ok with a timestamp', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: HEALTH_PATH,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; time: string };
    expect(body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});
