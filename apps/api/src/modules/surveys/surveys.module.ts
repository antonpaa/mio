import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import { SurveysService } from './surveys.service.js';
import { PatientSurveysController } from './http/surveys.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [PatientSurveysController],
  providers: [SurveysService, PatientSessionGuard],
})
export class SurveysModule {}
