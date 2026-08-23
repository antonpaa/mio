import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PATIENT_AUTH } from '../modules/identity/index.js';
import type { AuthService } from '../modules/identity/index.js';
import { readSessionCookie } from '../modules/identity/http/cookies.js';

/** The patient principal attached by PatientSessionGuard. */
export interface PatientPrincipal {
  userId: string;
  givenName: string;
  familyName: string;
}

interface RequestWithPatient extends FastifyRequest {
  patientPrincipal?: PatientPrincipal;
}

@Injectable()
export class PatientSessionGuard implements CanActivate {
  constructor(@Inject(PATIENT_AUTH) private readonly patientAuth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPatient>();
    const state = await this.patientAuth.validateSession(readSessionCookie(request, 'patient'));
    if (state.status !== 'active') throw new UnauthorizedException({ status: 'none' });
    request.patientPrincipal = {
      userId: state.account.id,
      givenName: state.account.given_name,
      familyName: state.account.family_name,
    };
    return true;
  }
}

export const CurrentPatient = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PatientPrincipal => {
    const request = context.switchToHttp().getRequest<RequestWithPatient>();
    if (!request.patientPrincipal) throw new UnauthorizedException({ status: 'none' });
    return request.patientPrincipal;
  },
);
