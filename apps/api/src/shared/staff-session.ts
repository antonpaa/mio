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

/** The staff principal attached to a request by StaffSessionGuard.
 * An account HOLDS roles (plural - the grants union); an account whose
 * role set is somehow empty never gets past the guard. */
export interface StaffPrincipal {
  userId: string;
  roles: readonly Role[];
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
    const roles = (state.account.roles ?? []) as Role[];
    if (roles.length === 0) throw new UnauthorizedException({ status: 'none' });
    request.staffPrincipal = {
      userId: state.account.id,
      roles,
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
