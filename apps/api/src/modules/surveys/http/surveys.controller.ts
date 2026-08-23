import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { Answers, LocaleBundle, SurveyDefinition } from '@mio/survey-schema';
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

  @Post('surveys')
  @HttpCode(201)
  createSurvey(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: { name?: string; kind?: string; licensedSource?: string },
  ) {
    return this.surveys.createSurvey(staff, {
      name: body.name ?? '',
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.licensedSource !== undefined ? { licensedSource: body.licensedSource } : {}),
    });
  }

  @Get('surveys/versions/:versionId')
  version(@CurrentStaff() staff: StaffPrincipal, @Param('versionId') versionId: string) {
    return this.surveys.versionDetail(staff, versionId);
  }

  @Post('surveys/versions/:versionId')
  @HttpCode(200)
  updateDraft(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('versionId') versionId: string,
    @Body() body: { definition?: SurveyDefinition; locales?: LocaleBundle[] },
  ) {
    return this.surveys.updateDraft(staff, versionId, {
      definition: body.definition ?? { pages: [] },
      locales: body.locales ?? [],
    });
  }

  @Post('surveys/versions/:versionId/publish')
  @HttpCode(200)
  publish(@CurrentStaff() staff: StaffPrincipal, @Param('versionId') versionId: string) {
    return this.surveys.publishVersion(staff, versionId);
  }

  @Post('surveys/versions/:versionId/archive')
  @HttpCode(200)
  archive(@CurrentStaff() staff: StaffPrincipal, @Param('versionId') versionId: string) {
    return this.surveys.archiveVersion(staff, versionId);
  }

  @Get('surveys/:surveyId')
  survey(@CurrentStaff() staff: StaffPrincipal, @Param('surveyId') surveyId: string) {
    return this.surveys.surveyDetail(staff, surveyId);
  }

  @Post('surveys/:surveyId/draft')
  @HttpCode(201)
  newDraft(@CurrentStaff() staff: StaffPrincipal, @Param('surveyId') surveyId: string) {
    return this.surveys.newDraft(staff, surveyId);
  }

  @Get('treatments/:treatmentId/surveys/:surveyId/rules')
  programRules(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Param('surveyId') surveyId: string,
  ) {
    return this.surveys.programRules(staff, treatmentId, surveyId);
  }

  @Post('treatments/:treatmentId/surveys/:surveyId/rules')
  @HttpCode(200)
  saveProgramRules(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Param('surveyId') surveyId: string,
    @Body() body: { overrides?: object },
  ) {
    return this.surveys.saveProgramRules(
      staff,
      treatmentId,
      surveyId,
      (body.overrides ?? {}) as never,
    );
  }

  @Get('responses/:responseId')
  responseDetail(@CurrentStaff() staff: StaffPrincipal, @Param('responseId') responseId: string) {
    return this.surveys.responseDetail(staff, responseId);
  }

  @Get('patients/:patientId/responses')
  patientResponses(@CurrentStaff() staff: StaffPrincipal, @Param('patientId') patientId: string) {
    return this.surveys.patientResponses(staff, patientId);
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
