import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { Answers } from '@mio/survey-schema';
import {
  CurrentPatient,
  PatientSessionGuard,
  type PatientPrincipal,
} from '../../../shared/patient-session.js';
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
