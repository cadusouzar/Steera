import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { QueryReceivablesDto } from './dto/query-receivables.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { ReceivablesService } from './receivables.service';

@UseGuards(ModulesGuard, PermissionsGuard)
// Achado 5 da revisão final (27/09/2026): lançamentos derivam o módulo FINANCAS no perfil — aceita
// CLIENTES ou FINANCAS (OR no ModulesGuard/PlanGuard); a permissão de cada rota continua exigida.
@RequireModule('CLIENTES', 'FINANCAS')
@Controller()
export class ReceivablesController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @RequirePermission('financas.lancamentos.gerenciar')
  @Post('clients/:clientId/receivables')
  create(@Param('clientId') clientId: string, @Body() dto: CreateReceivableDto) {
    return this.receivablesService.create(clientId, dto);
  }

  @RequirePermission('financas.lancamentos.ver')
  @Get('clients/:clientId/receivables')
  findAllForClient(@Param('clientId') clientId: string, @Query() query: QueryReceivablesDto) {
    return this.receivablesService.findAllForClient(clientId, query);
  }

  @RequirePermission('financas.lancamentos.ver')
  @Get('receivables/:id')
  findOne(@Param('id') id: string) {
    return this.receivablesService.findOne(id);
  }

  @RequirePermission('financas.lancamentos.gerenciar')
  @Patch('receivables/:id')
  update(@Param('id') id: string, @Body() dto: UpdateReceivableDto) {
    return this.receivablesService.update(id, dto);
  }

  @RequirePermission('financas.lancamentos.gerenciar')
  @Patch('receivables/:id/pay')
  pay(@Param('id') id: string) {
    return this.receivablesService.pay(id);
  }

  @RequirePermission('financas.lancamentos.gerenciar')
  @Patch('receivables/:id/unpay')
  unpay(@Param('id') id: string) {
    return this.receivablesService.unpay(id);
  }

  @RequirePermission('financas.lancamentos.gerenciar')
  @Delete('receivables/:id')
  remove(@Param('id') id: string) {
    return this.receivablesService.remove(id);
  }
}
