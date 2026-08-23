import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from '../domain/auth.service.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies.js';
import { CONFIG } from '../../../shared/config.module.js';
import type { ApiConfig } from '../../../shared/config.js';
import { PATIENT_AUTH, STAFF_AUTH } from '../identity.tokens.js';

interface LoginBody {
  email?: string;
  password?: string;
}
interface VerifyBody {
  challengeId?: string;
  code?: string;
}

/**
 * One controller class per realm, one route prefix per realm, one cookie
 * per realm - the separation is structural, not a parameter.
 */
abstract class RealmAuthController {
  protected constructor(
    protected readonly auth: AuthService,
    protected readonly config: ApiConfig,
  ) {}

  protected async login(body: LoginBody, request: FastifyRequest): Promise<object> {
    const email = body.email?.trim() ?? '';
    const password = body.password ?? '';
    if (!email || !password) throw new UnauthorizedException({ status: 'invalid' });
    const result = await this.auth.beginLogin(email, password, request.ip);
    if (result.status === 'invalid') throw new UnauthorizedException({ status: 'invalid' });
    if (result.status === 'delayed') {
      throw new UnauthorizedException({
        status: 'delayed',
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    return { status: 'otp_sent', challengeId: result.challengeId };
  }

  protected async verify(
    body: VerifyBody,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<object> {
    const result = await this.auth.verifyOtp(body.challengeId ?? '', body.code ?? '', request.ip);
    if (result.status !== 'session') {
      throw new UnauthorizedException({ status: result.status });
    }
    setSessionCookie(reply, this.auth.realm, result.sessionId, this.config.cookieSecure);
    return {
      status: 'signed_in',
      account: {
        id: result.account.id,
        givenName: result.account.given_name,
        familyName: result.account.family_name,
        locale: result.account.locale,
        ...(result.account.role !== undefined ? { role: result.account.role } : {}),
      },
    };
  }

  protected async resend(body: { challengeId?: string }): Promise<object> {
    await this.auth.resendOtp(body.challengeId ?? '');
    // Uniform response: resend never confirms whether a challenge exists.
    return { status: 'ok' };
  }

  protected async whoami(request: FastifyRequest): Promise<object> {
    const state = await this.auth.validateSession(readSessionCookie(request, this.auth.realm));
    if (state.status !== 'active') throw new UnauthorizedException({ status: 'none' });
    return {
      account: {
        id: state.account.id,
        givenName: state.account.given_name,
        familyName: state.account.family_name,
        locale: state.account.locale,
        ...(state.account.role !== undefined ? { role: state.account.role } : {}),
      },
    };
  }

  protected async logout(request: FastifyRequest, reply: FastifyReply): Promise<object> {
    const sessionId = readSessionCookie(request, this.auth.realm);
    if (sessionId) await this.auth.revokeSession(sessionId);
    clearSessionCookie(reply, this.auth.realm, this.config.cookieSecure);
    return { status: 'signed_out' };
  }
}

@Controller('api/patient/auth')
export class PatientAuthController extends RealmAuthController {
  constructor(@Inject(PATIENT_AUTH) auth: AuthService, @Inject(CONFIG) config: ApiConfig) {
    super(auth, config);
  }
  @Post('login') @HttpCode(200) loginRoute(@Body() body: LoginBody, @Req() req: FastifyRequest) {
    return this.login(body, req);
  }
  @Post('verify') @HttpCode(200) verifyRoute(
    @Body() body: VerifyBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.verify(body, req, reply);
  }
  @Post('resend') @HttpCode(200) resendRoute(@Body() body: { challengeId?: string }) {
    return this.resend(body);
  }
  @Get('session') sessionRoute(@Req() req: FastifyRequest) {
    return this.whoami(req);
  }
  @Post('logout') @HttpCode(200) logoutRoute(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.logout(req, reply);
  }
}

@Controller('api/staff/auth')
export class StaffAuthController extends RealmAuthController {
  constructor(@Inject(STAFF_AUTH) auth: AuthService, @Inject(CONFIG) config: ApiConfig) {
    super(auth, config);
  }
  @Post('login') @HttpCode(200) loginRoute(@Body() body: LoginBody, @Req() req: FastifyRequest) {
    return this.login(body, req);
  }
  @Post('verify') @HttpCode(200) verifyRoute(
    @Body() body: VerifyBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.verify(body, req, reply);
  }
  @Post('resend') @HttpCode(200) resendRoute(@Body() body: { challengeId?: string }) {
    return this.resend(body);
  }
  @Get('session') sessionRoute(@Req() req: FastifyRequest) {
    return this.whoami(req);
  }
  @Post('logout') @HttpCode(200) logoutRoute(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.logout(req, reply);
  }
}
