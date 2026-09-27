import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { ReportsService } from './reports.service';

@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('CLIENTES')
@RequirePermission('financas.lancamentos.ver')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial-summary')
  async financialSummary(@Query('topDefaulters') topDefaulters?: string) {
    const limit = topDefaulters ? parseInt(topDefaulters, 10) : 5;
    return this.reportsService.financialSummary(Number.isFinite(limit) && limit > 0 ? limit : 5);
  }
}
