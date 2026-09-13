import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { ReportsService } from './reports.service';

@UseGuards(ModulesGuard)
@RequireModule('CLIENTES')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial-summary')
  async financialSummary(@Query('topDefaulters') topDefaulters?: string) {
    const limit = topDefaulters ? parseInt(topDefaulters, 10) : 5;
    return this.reportsService.financialSummary(Number.isFinite(limit) && limit > 0 ? limit : 5);
  }
}
