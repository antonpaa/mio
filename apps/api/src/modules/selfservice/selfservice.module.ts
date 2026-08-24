import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import { SelfServiceService } from './selfservice.service.js';
import { SelfServiceController } from './http/selfservice.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [SelfServiceController],
  providers: [SelfServiceService, PatientSessionGuard],
})
export class SelfServiceModule {}
