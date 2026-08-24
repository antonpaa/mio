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
import { MessagesService } from '../messages.service.js';

@Controller('api/staff/messages')
@UseGuards(StaffSessionGuard)
export class StaffMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  inbox(@CurrentStaff() staff: StaffPrincipal) {
    return this.messages.staffInbox(staff);
  }

  @Get('threads/:treatmentId')
  thread(@CurrentStaff() staff: StaffPrincipal, @Param('treatmentId') treatmentId: string) {
    return this.messages.staffThread(staff, treatmentId);
  }

  @Post('threads/:treatmentId/messages')
  @HttpCode(201)
  post(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Body() body: { body?: unknown },
  ) {
    return this.messages.staffPost(staff, treatmentId, body.body);
  }

  @Post('threads/:treatmentId/notes')
  @HttpCode(201)
  postNote(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Body() body: { body?: unknown },
  ) {
    return this.messages.staffPostNote(staff, treatmentId, body.body);
  }
}

@Controller('api/patient/messages')
@UseGuards(PatientSessionGuard)
export class PatientMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  threads(@CurrentPatient() patient: PatientPrincipal) {
    return this.messages.patientThreads(patient);
  }

  @Get('threads/:treatmentId')
  thread(@CurrentPatient() patient: PatientPrincipal, @Param('treatmentId') treatmentId: string) {
    return this.messages.patientThread(patient, treatmentId);
  }

  @Post('threads/:treatmentId/messages')
  @HttpCode(201)
  post(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Body() body: { body?: unknown },
  ) {
    return this.messages.patientPost(patient, treatmentId, body.body);
  }
}
