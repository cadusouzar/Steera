import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { EmployeeScopeService } from '../authorization/employee-scope.service';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateEmployeeRecurringPaymentDto } from './dto/create-employee-recurring-payment.dto';
import { UpdateEmployeeRecurringPaymentDto } from './dto/update-employee-recurring-payment.dto';
import { EmployeeRecurringPaymentsService } from './employee-recurring-payments.service';

const CODE = 'pagamentos.gerenciar';

// Permissões por ação e alcance (Task 4): mesma regra dos pagamentos avulsos — TODAS as rotas
// exigem pagamentos.gerenciar e usam o alcance dela, aplicado só aqui na entrada HTTP. O serviço
// (e EmployeeRecurringPaymentsBillingService, disparado pelo cron sem requisição) não conhece
// alcance nenhum. Rotas pelo id da recorrência respondem com o 404 da própria recorrência quando o
// funcionário dono está fora do alcance, antes de qualquer escrita.
@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('RH_FUNCIONARIOS')
@RequirePermission(CODE)
@Controller()
export class EmployeeRecurringPaymentsController {
  constructor(
    private readonly service: EmployeeRecurringPaymentsService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  // Devolve o funcionário dono pra escrita reaproveitar na checagem de próprios dados.
  private async assertRecurringInScope(id: string): Promise<string> {
    const employeeId = await this.service.findEmployeeIdOf(id);
    await this.employeeScope.assertEmployeeInScope(CODE, employeeId, `Recorrência ${id} não encontrada`);
    return employeeId;
  }

  @Post('employees/:employeeId/recurring-payments')
  async create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeeRecurringPaymentDto) {
    await this.employeeScope.assertEmployeeInScope(CODE, employeeId);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.create(employeeId, dto);
  }

  @Get('employees/:employeeId/recurring-payments')
  async findAllForEmployee(@Param('employeeId') employeeId: string) {
    await this.employeeScope.assertEmployeeInScope(CODE, employeeId);
    return this.service.findAllForEmployee(employeeId);
  }

  @Get('employee-recurring-payments/:id')
  async findOne(@Param('id') id: string) {
    await this.assertRecurringInScope(id);
    return this.service.findOne(id);
  }

  @Patch('employee-recurring-payments/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateEmployeeRecurringPaymentDto) {
    const employeeId = await this.assertRecurringInScope(id);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.update(id, dto);
  }

  @Delete('employee-recurring-payments/:id')
  async remove(@Param('id') id: string) {
    const employeeId = await this.assertRecurringInScope(id);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.remove(id);
  }

  @Post('employee-recurring-payments/:id/generate-charge')
  async generateCharge(@Param('id') id: string) {
    const employeeId = await this.assertRecurringInScope(id);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.generateCharge(id);
  }
}
