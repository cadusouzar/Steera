import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { FinancialSummaryQueryDto } from './dto/financial-summary-query.dto';
import { parseReportPeriod } from './report-period.util';
import { ReportsService } from './reports.service';

@UseGuards(ModulesGuard, PermissionsGuard)
// Achado 5 da revisão final (27/09/2026): lançamentos derivam o módulo FINANCAS no perfil — aceita
// CLIENTES ou FINANCAS (OR no ModulesGuard/PlanGuard); a permissão de cada rota continua exigida.
@RequireModule('CLIENTES', 'FINANCAS')
@RequirePermission('financas.lancamentos.ver')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial-summary')
  async financialSummary(@Query() query: FinancialSummaryQueryDto) {
    const limit = query.topDefaulters ? parseInt(query.topDefaulters, 10) : 5;
    const period = parseReportPeriod(query.from, query.to, query.tz);
    return this.reportsService.financialSummary(Number.isFinite(limit) && limit > 0 ? limit : 5, period);
  }
}
