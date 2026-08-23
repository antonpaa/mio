import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import {
  OwnTreatmentsController,
  PatientTreatmentsController,
  TemplatesController,
  TreatmentsController,
} from './http/treatments.controller.js';
import { TreatmentsService } from './treatments.service.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [
    TemplatesController,
    TreatmentsController,
    PatientTreatmentsController,
    OwnTreatmentsController,
  ],
  providers: [TreatmentsService, StaffSessionGuard, PatientSessionGuard],
})
export class TreatmentsModule {}
