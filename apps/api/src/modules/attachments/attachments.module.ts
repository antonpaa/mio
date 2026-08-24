import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { StorageModule } from '../../shared/storage.module.js';
import { IdentityModule } from '../identity/index.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { AttachmentsService } from './attachments.service.js';
import {
  PatientAttachmentsController,
  StaffAttachmentsController,
} from './http/attachments.controller.js';

@Module({
  imports: [DbModule, StorageModule, IdentityModule],
  controllers: [PatientAttachmentsController, StaffAttachmentsController],
  providers: [AttachmentsService, PatientSessionGuard, StaffSessionGuard],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
