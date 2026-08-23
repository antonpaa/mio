import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { OnboardingService } from '../domain/onboarding.service.js';
import { PATIENT_ONBOARDING, STAFF_ONBOARDING } from '../identity.tokens.js';

abstract class RealmOnboardingController {
  protected constructor(protected readonly onboarding: OnboardingService) {}

  protected async inspect(token: string): Promise<object> {
    const result = await this.onboarding.inspectInvite(token);
    if (result.status !== 'ok') throw new NotFoundException({ status: 'invalid' });
    return result;
  }

  protected async accept(body: {
    token?: string;
    password?: string;
    acceptTerms?: boolean;
  }): Promise<object> {
    const result = await this.onboarding.acceptInvite(
      body.token ?? '',
      body.password ?? '',
      body.acceptTerms === true,
    );
    if (result.status === 'otp_sent') return result;
    throw new BadRequestException(result);
  }

  protected async forgot(body: { email?: string }): Promise<object> {
    if (body.email) await this.onboarding.requestReset(body.email);
    // Uniform response, always - the enumeration-oracle rule.
    return { status: 'ok' };
  }

  protected async reset(body: { token?: string; password?: string }): Promise<object> {
    const result = await this.onboarding.completeReset(body.token ?? '', body.password ?? '');
    if (result.status === 'ok') return result;
    throw new BadRequestException(result);
  }
}

@Controller('api/patient/auth')
export class PatientOnboardingController extends RealmOnboardingController {
  constructor(@Inject(PATIENT_ONBOARDING) onboarding: OnboardingService) {
    super(onboarding);
  }
  @Get('invite/:token') inspectRoute(@Param('token') token: string) {
    return this.inspect(token);
  }
  @Post('invite/accept') @HttpCode(200) acceptRoute(@Body() body: never) {
    return this.accept(body);
  }
  @Post('forgot') @HttpCode(200) forgotRoute(@Body() body: { email?: string }) {
    return this.forgot(body);
  }
  @Post('reset') @HttpCode(200) resetRoute(@Body() body: never) {
    return this.reset(body);
  }
}

@Controller('api/staff/auth')
export class StaffOnboardingController extends RealmOnboardingController {
  constructor(@Inject(STAFF_ONBOARDING) onboarding: OnboardingService) {
    super(onboarding);
  }
  @Get('invite/:token') inspectRoute(@Param('token') token: string) {
    return this.inspect(token);
  }
  @Post('invite/accept') @HttpCode(200) acceptRoute(@Body() body: never) {
    return this.accept(body);
  }
  @Post('forgot') @HttpCode(200) forgotRoute(@Body() body: { email?: string }) {
    return this.forgot(body);
  }
  @Post('reset') @HttpCode(200) resetRoute(@Body() body: never) {
    return this.reset(body);
  }
}
