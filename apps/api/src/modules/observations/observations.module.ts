import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { ObservationsService } from './observations.service.js';
import { ObservationsController } from './http/observations.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [ObservationsController],
  providers: [ObservationsService, StaffSessionGuard],
})
export class ObservationsModule {}
