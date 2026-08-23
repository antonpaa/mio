import { Module } from '@nestjs/common';
import { loadConfig } from './config.js';

export const CONFIG = Symbol('CONFIG');

@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig() }],
  exports: [CONFIG],
})
export class ConfigModule {}
