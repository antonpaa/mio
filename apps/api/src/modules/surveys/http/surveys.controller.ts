import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { Answers } from '@mio/survey-schema';
import type { ScheduleSegment } from '@mio/schedule';
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
import { SurveysService } from '../surveys.service.js';

@Controller('api/patient')
@UseGuards(PatientSessionGuard)
export class PatientSurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get('surveys')
  list(@CurrentPatient() patient: PatientPrincipal) {
    return this.surveys.listForPatient(patient);
  }

  @Post('surveys/:surveyId/start')
  @HttpCode(201)
  start(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('surveyId') surveyId: string,
    @Body() body: { treatmentId?: string },
  ) {
    return this.surveys.start(patient, surveyId, body.treatmentId ?? '');
  }

  @Get('responses/:id')
  response(@CurrentPatient() patient: PatientPrincipal, @Param('id') id: string) {
    return this.surveys.getResponse(patient, id);
  }

  @Post('responses/:id/answers')
  @HttpCode(200)
  save(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('id') id: string,
    @Body() body: { answers?: Answers },
  ) {
    return this.surveys.saveDraft(patient, id, body.answers ?? {});
  }

  @Post('activities/:activityId/fill')
  @HttpCode(201)
  fillOccurrence(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('activityId') activityId: string,
  ) {
    return this.surveys.startFromActivity(patient, activityId);
  }

  @Post('responses/:id/submit')
  @HttpCode(200)
  submit(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('id') id: string,
    @Body() body: { answers?: Answers },
  ) {
    return this.surveys.submit(patient, id, body.answers ?? {});
  }
}

@Controller('api/staff')
@UseGuards(StaffSessionGuard)
export class StaffSurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get('surveys')
  catalog(@CurrentStaff() staff: StaffPrincipal) {
    return this.surveys.catalog(staff);
  }

  @Get('treatments/:treatmentId/surveys')
  assignments(@CurrentStaff() staff: StaffPrincipal, @Param('treatmentId') treatmentId: string) {
    return this.surveys.listAssignments(staff, treatmentId);
  }

  @Post('treatments/:treatmentId/surveys')
  @HttpCode(201)
  assign(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Body()
    body: {
      surveyId?: string;
      versionId?: string;
      language?: string;
      mode?: 'now' | 'scheduled' | 'recurring';
      date?: string;
      anchorDate?: string;
      segments?: ScheduleSegment[];
      answerWindowDays?: number;
      reminderAfterDays?: number;
      escalateUnanswered?: boolean;
    },
  ) {
    return this.surveys.assign(staff, treatmentId, {
      surveyId: body.surveyId ?? '',
      mode: body.mode ?? 'now',
      ...(body.versionId !== undefined && body.versionId !== ''
        ? { versionId: body.versionId }
        : {}),
      ...(body.language !== undefined ? { language: body.language } : {}),
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.anchorDate !== undefined ? { anchorDate: body.anchorDate } : {}),
      ...(body.segments !== undefined ? { segments: body.segments } : {}),
      ...(body.answerWindowDays !== undefined ? { answerWindowDays: body.answerWindowDays } : {}),
      ...(body.reminderAfterDays !== undefined
        ? { reminderAfterDays: body.reminderAfterDays }
        : {}),
      ...(body.escalateUnanswered !== undefined
        ? { escalateUnanswered: body.escalateUnanswered }
        : {}),
    });
  }
}
