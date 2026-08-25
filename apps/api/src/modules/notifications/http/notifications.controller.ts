import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import {
  CurrentPatient,
  PatientSessionGuard,
  type PatientPrincipal,
} from '../../../shared/patient-session.js';
import {
  CurrentStaff,
  StaffSessionGuard,
  type StaffPrincipal,
} from '../../../shared/staff-session.js';
import { NotificationsService } from '../notifications.service.js';

@Controller('api/patient')
@UseGuards(PatientSessionGuard)
export class PatientNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentPatient() patient: PatientPrincipal) {
    return this.notifications.list(patient);
  }

  @Post('notifications/read')
  @HttpCode(200)
  markAllRead(@CurrentPatient() patient: PatientPrincipal) {
    return this.notifications.markAllRead(patient);
  }

  @Get('settings/notifications')
  emailPrefs(@CurrentPatient() patient: PatientPrincipal) {
    return this.notifications.emailPrefs(patient);
  }

  @Put('settings/notifications')
  updateEmailPrefs(
    @CurrentPatient() patient: PatientPrincipal,
    @Body() body: { emailPrefs?: unknown },
  ) {
    return this.notifications.updateEmailPrefs(patient, body.emailPrefs ?? {});
  }
}

/** The staff notification centre: rule-authored notifications a B7
 * author addressed to the care team or its leads. */
@Controller('api/staff')
@UseGuards(StaffSessionGuard)
export class StaffNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentStaff() staff: StaffPrincipal) {
    return this.notifications.listForStaff(staff);
  }

  @Post('notifications/read')
  @HttpCode(200)
  markRead(@CurrentStaff() staff: StaffPrincipal) {
    return this.notifications.markAllReadForStaff(staff);
  }
}
