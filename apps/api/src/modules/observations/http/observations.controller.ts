import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentStaff,
  StaffSessionGuard,
  type StaffPrincipal,
} from '../../../shared/staff-session.js';
import { ObservationsService } from '../observations.service.js';

@Controller('api/staff/value-series')
@UseGuards(StaffSessionGuard)
export class SeriesCatalogController {
  constructor(private readonly observations: ObservationsService) {}

  /** X8: the catalog the builder's binding select lists - reference
   * data, no patient content. */
  @Get()
  catalog(@CurrentStaff() staff: StaffPrincipal) {
    return this.observations.seriesCatalog(staff);
  }
}

@Controller('api/staff/patients/:patientId')
@UseGuards(StaffSessionGuard)
export class ObservationsController {
  constructor(private readonly observations: ObservationsService) {}

  @Get('values')
  values(@CurrentStaff() staff: StaffPrincipal, @Param('patientId') patientId: string) {
    return this.observations.valuesSummary(staff, patientId);
  }

  @Get('values/:seriesId')
  series(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('patientId') patientId: string,
    @Param('seriesId') seriesId: string,
  ) {
    return this.observations.seriesDetail(staff, patientId, seriesId);
  }

  @Post('values/:seriesId')
  @HttpCode(201)
  createValue(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('patientId') patientId: string,
    @Param('seriesId') seriesId: string,
    @Body() body: { value?: number; measuredAt?: string; note?: string },
  ) {
    return this.observations.createValue(staff, patientId, seriesId, body);
  }

  @Get('symptoms')
  symptoms(@CurrentStaff() staff: StaffPrincipal, @Param('patientId') patientId: string) {
    return this.observations.symptomRegister(staff, patientId);
  }

  @Post('symptoms')
  @HttpCode(201)
  report(
    @CurrentStaff() staff: StaffPrincipal,
    @Param('patientId') patientId: string,
    @Body() body: { symptomId?: string; severity?: string; note?: string; observedAt?: string },
  ) {
    return this.observations.createObservation(staff, patientId, body);
  }
}
