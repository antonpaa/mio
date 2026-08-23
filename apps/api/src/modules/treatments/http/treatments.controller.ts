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
import { TreatmentsService, type TreatmentState } from '../treatments.service.js';

@Controller('api/staff/templates')
@UseGuards(StaffSessionGuard)
export class TemplatesController {
  constructor(private readonly treatments: TreatmentsService) {}

  @Get()
  list(@CurrentStaff() staff: StaffPrincipal) {
    return this.treatments.listTemplates(staff);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentStaff() staff: StaffPrincipal, @Body() body: { name?: string; detail?: string }) {
    return this.treatments.createTemplate(staff, {
      name: body.name ?? '',
      ...(body.detail !== undefined ? { detail: body.detail } : {}),
    });
  }

  @Post('versions/:versionId/publish')
  @HttpCode(200)
  async publish(@CurrentStaff() staff: StaffPrincipal, @Param('versionId') versionId: string) {
    await this.treatments.publishVersion(staff, versionId);
    return { status: 'published' };
  }

  @Post('versions/:versionId/new-draft')
  @HttpCode(201)
  newDraft(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('versionId') versionId: string,
    @Body() body: { definition?: object },
  ) {
    return this.treatments.newDraftFrom(staff, versionId, body.definition);
  }
}

@Controller('api/staff/treatments')
@UseGuards(StaffSessionGuard)
export class TreatmentsController {
  constructor(private readonly treatments: TreatmentsService) {}

  @Post()
  @HttpCode(201)
  instantiate(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: { templateVersionId?: string; patientId?: string; name?: string },
  ) {
    return this.treatments.instantiate(staff, {
      templateVersionId: body.templateVersionId ?? '',
      patientId: body.patientId ?? '',
      ...(body.name !== undefined ? { name: body.name } : {}),
    });
  }

  @Get(':id')
  detail(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.treatments.detail(staff, id);
  }

  @Post(':id/state')
  @HttpCode(200)
  changeState(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { to?: TreatmentState },
  ) {
    return this.treatments.changeState(staff, id, body.to as TreatmentState);
  }

  @Post(':id/team')
  @HttpCode(200)
  async addTeam(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { staffId?: string; teamId?: string; role?: 'member' | 'lead' },
  ) {
    await this.treatments.addTeamEntry(staff, id, body);
    return { status: 'added' };
  }
}

@Controller('api/staff/patients/:patientId/treatments')
@UseGuards(StaffSessionGuard)
export class PatientTreatmentsController {
  constructor(private readonly treatments: TreatmentsService) {}

  @Get()
  list(@CurrentStaff() staff: StaffPrincipal, @Param('patientId') patientId: string) {
    return this.treatments.forPatient(staff, patientId);
  }
}

@Controller('api/patient/treatments')
@UseGuards(PatientSessionGuard)
export class OwnTreatmentsController {
  constructor(private readonly treatments: TreatmentsService) {}

  @Get()
  list(@CurrentPatient() patient: PatientPrincipal) {
    return this.treatments.ownTreatments(patient.userId);
  }
}
