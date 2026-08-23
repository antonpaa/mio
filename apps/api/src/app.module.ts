import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/index.js';
import { IdentityModule } from './modules/identity/index.js';
import { PatientsModule } from './modules/patients/index.js';
import { TreatmentsModule } from './modules/treatments/index.js';
import { SchedulingModule } from './modules/scheduling/index.js';
import { TasksModule } from './modules/tasks/index.js';
import { SurveysModule } from './modules/surveys/index.js';
import { AlertsModule } from './modules/alerts/index.js';
import { ObservationsModule } from './modules/observations/index.js';

/**
 * The modular monolith root (ADR-0002). Every domain module registers here
 * and is imported by others only through its public index - enforced by the
 * dependency-cruiser boundary rules at the repo root.
 */
@Module({
  imports: [
    HealthModule,
    IdentityModule,
    PatientsModule,
    TreatmentsModule,
    SchedulingModule,
    TasksModule,
    SurveysModule,
    AlertsModule,
    ObservationsModule,
  ],
})
export class AppModule {}
