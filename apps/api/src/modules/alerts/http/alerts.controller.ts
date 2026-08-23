import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentStaff,
  StaffSessionGuard,
  type StaffPrincipal,
} from '../../../shared/staff-session.js';
import { AlertsService } from '../alerts.service.js';

@Controller('api/staff/alerts')
@UseGuards(StaffSessionGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  triage(@CurrentStaff() staff: StaffPrincipal) {
    return this.alerts.triage(staff);
  }

  @Get(':id')
  detail(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.alerts.detail(staff, id);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  acknowledge(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.alerts.acknowledge(staff, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  assign(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { assigneeId?: string },
  ) {
    return this.alerts.assign(staff, id, body.assigneeId ?? '');
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.alerts.resolve(staff, id);
  }

  @Post(':id/comments')
  @HttpCode(201)
  comment(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { body?: string },
  ) {
    return this.alerts.comment(staff, id, body.body ?? '');
  }
}
