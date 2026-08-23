import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  CurrentStaff,
  StaffSessionGuard,
  type StaffPrincipal,
} from '../../../shared/staff-session.js';
import { PatientsService } from '../patients.service.js';

@Controller('api/staff/patients')
@UseGuards(StaffSessionGuard)
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  roster(@CurrentStaff() staff: StaffPrincipal) {
    return this.patients.roster(staff);
  }

  @Get(':id')
  profile(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.patients.profile(staff, id);
  }
}
