import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
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
import { AttachmentsService } from '../attachments.service.js';

/** Hostile-content headers on every served byte stream: the sniffed
 * type, no sniffing latitude, no scripting, no caching beyond the
 * client. The separate serving ORIGIN is deployment topology (WP-09);
 * these headers are the application's half of the contract. */
function sendBytes(
  reply: FastifyReply,
  payload: { bytes: Uint8Array; mime: string; filename: string },
): void {
  void reply
    .header('content-type', payload.mime)
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('cache-control', 'private, max-age=300')
    .header(
      'content-disposition',
      `inline; filename="${payload.filename.replace(/[^\w.\- ]/g, '_')}"`,
    )
    .send(Buffer.from(payload.bytes));
}

@Controller('api/patient/attachments')
@UseGuards(PatientSessionGuard)
export class PatientAttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @HttpCode(201)
  upload(
    @CurrentPatient() patient: PatientPrincipal,
    @Body() body: { treatmentId?: string; filename?: string; dataBase64?: string },
  ) {
    return this.attachments.uploadAsPatient(patient, body);
  }

  @Get(':id')
  async fetch(
    @CurrentPatient() patient: PatientPrincipal,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.attachments.fetch(
      { userId: patient.userId, role: 'patient', realm: 'patient' },
      id,
    );
    if (result.kind === 'bytes') return sendBytes(reply, result);
    return reply.code(result.state === 'rejected' ? 410 : 202).send({ state: result.state });
  }
}

@Controller('api/staff/attachments')
@UseGuards(StaffSessionGuard)
export class StaffAttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @HttpCode(201)
  upload(
    @CurrentStaff() staff: StaffPrincipal,
    @Body() body: { treatmentId?: string; filename?: string; dataBase64?: string },
  ) {
    return this.attachments.uploadAsStaff(staff, body);
  }

  @Get(':id')
  async fetch(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.attachments.fetch(
      { userId: staff.userId, role: staff.role, realm: 'staff' },
      id,
    );
    if (result.kind === 'bytes') return sendBytes(reply, result);
    return reply.code(result.state === 'rejected' ? 410 : 202).send({ state: result.state });
  }
}
