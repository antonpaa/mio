import { Controller, Get } from '@nestjs/common';
import { HEALTH_PATH, type HealthResponse } from '@mio/contracts';
import { HealthService } from './health.service.js';

@Controller()
export class HealthController {
  // Constructor injection on purpose: it fails at runtime unless the
  // compiler emits decorator metadata, so this controller is the canary
  // for the SWC-based toolchain.
  constructor(private readonly health: HealthService) {}

  @Get(HEALTH_PATH)
  get(): HealthResponse {
    return { status: 'ok', time: this.health.now() };
  }
}
