import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { ReportingService } from './reporting.service.js';
import { ReportingController } from './http/reporting.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [ReportingController],
  providers: [ReportingService, StaffSessionGuard],
})
export class ReportingModule {}
