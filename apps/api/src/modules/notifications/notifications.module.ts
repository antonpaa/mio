import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { NotificationsService } from './notifications.service.js';
import {
  PatientNotificationsController,
  StaffNotificationsController,
} from './http/notifications.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [PatientNotificationsController, StaffNotificationsController],
  providers: [NotificationsService, PatientSessionGuard, StaffSessionGuard],
})
export class NotificationsModule {}
