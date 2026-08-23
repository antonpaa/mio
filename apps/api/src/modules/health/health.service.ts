import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  now(): string {
    return new Date().toISOString();
  }
}
