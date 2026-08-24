import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { AlertsService } from './alerts.service.js';
import { AlertsController } from './http/alerts.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [AlertsController],
  providers: [AlertsService, StaffSessionGuard],
})
export class AlertsModule {}
