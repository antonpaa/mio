import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentStaff,
  StaffSessionGuard,
  type StaffPrincipal,
} from '../../../shared/staff-session.js';
import { TasksService } from '../tasks.service.js';

@Controller('api/staff/treatments/:treatmentId')
@UseGuards(StaffSessionGuard)
export class TreatmentTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('tasks')
  list(@CurrentStaff() staff: StaffPrincipal, @Param('treatmentId') treatmentId: string) {
    return this.tasks.listForTreatment(staff, treatmentId);
  }

  @Get('staff')
  staffList(@CurrentStaff() staff: StaffPrincipal, @Param('treatmentId') treatmentId: string) {
    return this.tasks.treatmentStaff(staff, treatmentId);
  }

  @Post('tasks')
  @HttpCode(201)
  create(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('treatmentId') treatmentId: string,
    @Body()
    body: {
      title?: string;
      detail?: string;
      dueDate?: string;
      assigneeId?: string;
      activityId?: string;
    },
  ) {
    return this.tasks.createTask(staff, treatmentId, {
      title: body.title ?? '',
      ...(body.detail !== undefined ? { detail: body.detail } : {}),
      ...(body.dueDate !== undefined && body.dueDate !== '' ? { dueDate: body.dueDate } : {}),
      ...(body.assigneeId !== undefined && body.assigneeId !== ''
        ? { assigneeId: body.assigneeId }
        : {}),
      ...(body.activityId !== undefined ? { activityId: body.activityId } : {}),
    });
  }
}

@Controller('api/staff/tasks')
@UseGuards(StaffSessionGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  worklist(@CurrentStaff() staff: StaffPrincipal) {
    return this.tasks.worklist(staff);
  }

  @Post(':id/claim')
  @HttpCode(200)
  claim(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.tasks.claim(staff, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  assign(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('id') id: string,
    @Body() body: { assigneeId?: string },
  ) {
    return this.tasks.assign(staff, id, body.assigneeId ?? '');
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentStaff() staff: StaffPrincipal, @Param('id') id: string) {
    return this.tasks.complete(staff, id);
  }
}
