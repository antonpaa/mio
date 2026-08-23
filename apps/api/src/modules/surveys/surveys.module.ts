import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { SurveysService } from './surveys.service.js';
import { PatientSurveysController, StaffSurveysController } from './http/surveys.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [PatientSurveysController, StaffSurveysController],
  providers: [SurveysService, PatientSessionGuard, StaffSessionGuard],
})
export class SurveysModule {}
