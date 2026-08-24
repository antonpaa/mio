import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import { ObservationsService } from './observations.service.js';
import {
  ObservationsController,
  PatientSymptomsController,
  SeriesCatalogController,
} from './http/observations.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [ObservationsController, PatientSymptomsController, SeriesCatalogController],
  providers: [ObservationsService, StaffSessionGuard, PatientSessionGuard],
})
export class ObservationsModule {}
