import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial-summary')
  async financialSummary(@Query('topDefaulters') topDefaulters?: string) {
    const limit = topDefaulters ? parseInt(topDefaulters, 10) : 5;
    return this.reportsService.financialSummary(Number.isFinite(limit) && limit > 0 ? limit : 5);
  }
}
