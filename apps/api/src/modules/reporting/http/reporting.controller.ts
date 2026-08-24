import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  CurrentStaff,
  StaffSessionGuard,
  type StaffPrincipal,
} from '../../../shared/staff-session.js';
import { ReportingService } from '../reporting.service.js';

@Controller('api/staff/reporting')
@UseGuards(StaffSessionGuard)
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get()
  overview(@CurrentStaff() staff: StaffPrincipal) {
    return this.reporting.overview(staff);
  }
}
