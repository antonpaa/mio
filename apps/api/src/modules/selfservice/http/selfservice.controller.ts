import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import {
  CurrentPatient,
  PatientSessionGuard,
  type PatientPrincipal,
} from '../../../shared/patient-session.js';
import { SelfServiceService } from '../selfservice.service.js';

@Controller('api/patient')
@UseGuards(PatientSessionGuard)
export class SelfServiceController {
  constructor(private readonly selfService: SelfServiceService) {}

  @Get('settings/profile')
  profile(@CurrentPatient() patient: PatientPrincipal) {
    return this.selfService.profile(patient);
  }

  @Put('settings/profile')
  updateProfile(
    @CurrentPatient() patient: PatientPrincipal,
    @Body() body: { phone?: unknown; address?: unknown; locale?: unknown },
  ) {
    return this.selfService.updateProfile(patient, body);
  }

  @Get('privacy/access-history')
  accessHistory(@CurrentPatient() patient: PatientPrincipal) {
    return this.selfService.accessHistory(patient);
  }

  @Post('privacy/export')
  @HttpCode(200)
  export(@CurrentPatient() patient: PatientPrincipal) {
    return this.selfService.export(patient);
  }
}
