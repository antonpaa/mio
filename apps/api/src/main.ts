import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 8 * 1024 * 1024 }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}

void bootstrap();
