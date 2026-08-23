import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { PatientsController } from './http/patients.controller.js';
import { PatientsService } from './patients.service.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [PatientsController],
  providers: [PatientsService, StaffSessionGuard],
})
export class PatientsModule {}
