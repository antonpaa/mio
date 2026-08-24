import { Module } from '@nestjs/common';
import { DbModule } from '../../shared/db.module.js';
import { IdentityModule } from '../identity/index.js';
import { StaffSessionGuard } from '../../shared/staff-session.js';
import { PatientSessionGuard } from '../../shared/patient-session.js';
import { MessagesService } from './messages.service.js';
import { PatientMessagesController, StaffMessagesController } from './http/messages.controller.js';

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [StaffMessagesController, PatientMessagesController],
  providers: [MessagesService, StaffSessionGuard, PatientSessionGuard],
})
export class MessagesModule {}
