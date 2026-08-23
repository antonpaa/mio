import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/index.js';

/**
 * The modular monolith root (ADR-0002). Every domain module registers here
 * and is imported by others only through its public index - enforced by the
 * dependency-cruiser boundary rules at the repo root.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
