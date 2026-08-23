import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Role } from '@mio/authz';
import { STAFF_AUTH } from '../modules/identity/index.js';
import type { AuthService } from '../modules/identity/index.js';
import { readSessionCookie } from '../modules/identity/http/cookies.js';
import { Inject } from '@nestjs/common';

/** The staff principal attached to a request by StaffSessionGuard. */
export interface StaffPrincipal {
  userId: string;
  role: Role;
  givenName: string;
  familyName: string;
}

interface RequestWithPrincipal extends FastifyRequest {
  staffPrincipal?: StaffPrincipal;
}

@Injectable()
export class StaffSessionGuard implements CanActivate {
  constructor(@Inject(STAFF_AUTH) private readonly staffAuth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const state = await this.staffAuth.validateSession(readSessionCookie(request, 'staff'));
    if (state.status !== 'active') throw new UnauthorizedException({ status: 'none' });
    request.staffPrincipal = {
      userId: state.account.id,
      role: (state.account.role ?? 'treatment_member') as Role,
      givenName: state.account.given_name,
      familyName: state.account.family_name,
    };
    return true;
  }
}

export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StaffPrincipal => {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    if (!request.staffPrincipal) throw new UnauthorizedException({ status: 'none' });
    return request.staffPrincipal;
  },
);
