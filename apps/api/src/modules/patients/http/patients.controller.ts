import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
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

  @Post(':id/export')
  @HttpCode(200)
  export(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.patients.exportPatient(staff, id, body.reason);
  }

  // PP5 assisted edit: the care team corrects what the patient told them
  @Post(':id/contact')
  @HttpCode(200)
  updateContact(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { phone?: unknown; address?: unknown; locale?: unknown },
  ) {
    return this.patients.updateContactDetails(staff, id, body);
  }

  @Post(':id/deceased')
  @HttpCode(200)
  markDeceased(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { date?: string },
  ) {
    return this.patients.markDeceased(staff, id, body.date);
  }

  @Get(':id')
  profile(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.patients.profile(staff, id);
  }
}
