import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CurrentStaff,
  StaffSessionGuard,
  type StaffPrincipal,
} from '../../../shared/staff-session.js';
import { AdminService } from '../admin.service.js';

@Controller('api/admin')
@UseGuards(StaffSessionGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users(@CurrentStaff() staff: StaffPrincipal) {
    return this.admin.listUsers(staff);
  }

  @Post('staff')
  @HttpCode(201)
  createStaff(
    @CurrentStaff() staff: StaffPrincipal,
    @Body()
    body: {
      email?: string;
      givenName?: string;
      familyName?: string;
      role?: string;
      title?: string;
      locale?: string;
    },
  ) {
    return this.admin.createStaff(staff, body);
  }

  @Post('users/:realm/:id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('realm') realm: string,
    @Param('id') id: string,
  ) {
    return this.admin.deactivate(staff, realm === 'staff' ? 'staff' : 'patient', id);
  }

  @Post('users/:realm/:id/reactivate')
  @HttpCode(200)
  reactivate(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('realm') realm: string,
    @Param('id') id: string,
  ) {
    return this.admin.reactivate(staff, realm === 'staff' ? 'staff' : 'patient', id);
  }

  @Post('users/:realm/:id/reset-login')
  @HttpCode(200)
  resetLogin(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('realm') realm: string,
    @Param('id') id: string,
    @Body() body: { password?: string },
  ) {
    return this.admin.resetLogin(staff, realm === 'staff' ? 'staff' : 'patient', id, body.password);
  }

  @Get('teams')
  teams(@CurrentStaff() staff: StaffPrincipal) {
    return this.admin.teams(staff);
  }

  @Post('teams')
  @HttpCode(201)
  createTeam(@CurrentStaff() staff: StaffPrincipal, @Body() body: { name?: string }) {
    return this.admin.createTeam(staff, body.name);
  }

  @Post('teams/:id/membership')
  @HttpCode(200)
  membership(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { add?: string[]; remove?: string[] },
  ) {
    return this.admin.updateMembership(staff, id, body.add ?? [], body.remove ?? []);
  }

  @Get('roles')
  roles() {
    return this.admin.roles();
  }

  @Get('audit')
  audit(@CurrentStaff() staff: StaffPrincipal, @Query('limit') limit?: string) {
    return this.admin.auditLog(staff, Number(limit ?? 200));
  }
}
