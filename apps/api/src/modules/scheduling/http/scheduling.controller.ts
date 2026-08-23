import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentStaff,
  StaffSessionGuard,
  type StaffPrincipal,
} from '../../../shared/staff-session.js';
import {
  CurrentPatient,
  PatientSessionGuard,
  type PatientPrincipal,
} from '../../../shared/patient-session.js';
import { SchedulingService, type ScheduleInput } from '../scheduling.service.js';

@Controller('api/staff/treatments/:treatmentId')
@UseGuards(StaffSessionGuard)
export class TreatmentSchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('activities')
  list(@CurrentStaff() staff: StaffPrincipal, @Param('treatmentId') treatmentId: string) {
    return this.scheduling.listActivities(staff, treatmentId);
  }

  @Post('activities')
  @HttpCode(201)
  create(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Body()
    body: { title?: string; kind?: string; location?: string; date?: string; timeOfDay?: string },
  ) {
    return this.scheduling.createActivity(staff, treatmentId, {
      title: body.title ?? '',
      date: body.date ?? '',
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.timeOfDay !== undefined ? { timeOfDay: body.timeOfDay } : {}),
    });
  }

  @Post('schedules')
  @HttpCode(201)
  createSchedule(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Body() body: ScheduleInput,
  ) {
    return this.scheduling.createSchedule(staff, treatmentId, body);
  }
}

@Controller('api/staff/activities')
@UseGuards(StaffSessionGuard)
export class ActivityController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Post(':id/status')
  @HttpCode(200)
  status(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { to?: string },
  ) {
    return this.scheduling.changeActivityStatus(staff, id, body.to ?? '');
  }

  @Post(':id/remind')
  @HttpCode(200)
  remind(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.scheduling.remindActivity(staff, id);
  }
}

/** C1's worklists (WP-27): overdue occurrences and the week's agenda. */
@Controller('api/staff/dashboard')
@UseGuards(StaffSessionGuard)
export class StaffDashboardController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('overdue')
  overdue(@CurrentStaff() staff: StaffPrincipal) {
    return this.scheduling.staffOverdue(staff);
  }

  @Get('agenda')
  agenda(@CurrentStaff() staff: StaffPrincipal) {
    return this.scheduling.staffAgenda(staff);
  }
}

@Controller('api/staff/schedules')
@UseGuards(StaffSessionGuard)
export class ScheduleController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Post(':id')
  @HttpCode(200)
  update(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body()
    body: {
      anchorDate?: string;
      segments?: ScheduleInput['segments'];
      payload?: ScheduleInput['payload'];
    },
  ) {
    return this.scheduling.updateSchedule(staff, id, {
      anchorDate: body.anchorDate ?? '',
      segments: body.segments ?? [],
      payload: body.payload ?? { title: '' },
    });
  }
}

@Controller('api/patient/calendar')
@UseGuards(PatientSessionGuard)
export class PatientCalendarController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get()
  calendar(@CurrentPatient() patient: PatientPrincipal) {
    return this.scheduling.patientCalendar(patient.userId);
  }
}
