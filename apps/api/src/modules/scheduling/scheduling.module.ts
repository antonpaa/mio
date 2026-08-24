import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import {
  ActivityController,
  PatientCalendarController,
  ScheduleController,
  StaffDashboardController,
  TreatmentSchedulingController,
} from './http/scheduling.controller.js';
import { SchedulingService } from './scheduling.service.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [
    TreatmentSchedulingController,
    ActivityController,
    ScheduleController,
    StaffDashboardController,
    PatientCalendarController,
  ],
  providers: [SchedulingService, StaffSessionGuard, PatientSessionGuard],
})
export class SchedulingModule {}
