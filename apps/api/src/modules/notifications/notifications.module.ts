import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import { NotificationsService } from './notifications.service.js';
import { PatientNotificationsController } from './http/notifications.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [PatientNotificationsController],
  providers: [NotificationsService, PatientSessionGuard],
})
export class NotificationsModule {}
