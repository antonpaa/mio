import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { AdminService } from './admin.service.js';
import { AdminController } from './http/admin.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [AdminController],
  providers: [AdminService, StaffSessionGuard],
})
export class AdminModule {}
