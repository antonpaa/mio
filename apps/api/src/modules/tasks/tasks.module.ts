import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { TasksService } from './tasks.service.js';
import { TasksController, TreatmentTasksController } from './http/tasks.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [TreatmentTasksController, TasksController],
  providers: [TasksService, StaffSessionGuard],
})
export class TasksModule {}
