import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@UseGuards(ModulesGuard, PermissionsGuard)
// Achado 5 da revisão final (27/09/2026): lançamentos derivam o módulo FINANCAS no perfil — aceita
// CLIENTES ou FINANCAS (OR no ModulesGuard/PlanGuard); a permissão de cada rota continua exigida.
@RequireModule('CLIENTES', 'FINANCAS')
@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @RequirePermission('financas.lancamentos.gerenciar')
  @Post('clients/:clientId/subscriptions')
  create(@Param('clientId') clientId: string, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(clientId, dto);
  }

  @RequirePermission('financas.lancamentos.ver')
  @Get('clients/:clientId/subscriptions')
  findAllForClient(@Param('clientId') clientId: string) {
    return this.subscriptionsService.findAllForClient(clientId);
  }

  @RequirePermission('financas.lancamentos.ver')
  @Get('subscriptions/:id')
  findOne(@Param('id') id: string) {
    return this.subscriptionsService.findOne(id);
  }

  @RequirePermission('financas.lancamentos.gerenciar')
  @Patch('subscriptions/:id')
  update(@Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.subscriptionsService.update(id, dto);
  }

  @RequirePermission('financas.lancamentos.gerenciar')
  @Delete('subscriptions/:id')
  remove(@Param('id') id: string) {
    return this.subscriptionsService.remove(id);
  }

  @RequirePermission('financas.lancamentos.gerenciar')
  @Post('subscriptions/:id/generate-charge')
  generateCharge(@Param('id') id: string) {
    return this.subscriptionsService.generateCharge(id);
  }
}
