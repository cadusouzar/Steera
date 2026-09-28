import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { EmployeeScopeService } from '../authorization/employee-scope.service';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateEmployeePaymentDto } from './dto/create-employee-payment.dto';
import { QueryEmployeePaymentsDto } from './dto/query-employee-payments.dto';
import { UpdateEmployeePaymentDto } from './dto/update-employee-payment.dto';
import { EmployeePaymentsService } from './employee-payments.service';

const CODE = 'pagamentos.gerenciar';

// Permissões por ação e alcance (Task 4): TODAS as rotas (leitura e escrita) exigem
// pagamentos.gerenciar e usam o alcance dela. O alcance é aplicado aqui, e não no serviço, pra não
// afetar chamadores internos. Rotas aninhadas checam o employeeId da URL; rotas pelo id do
// pagamento descobrem o funcionário dono primeiro e, fora do alcance, respondem com o MESMO 404 de
// um pagamento inexistente (nunca revelam que o registro existe). Sempre antes de qualquer escrita.
@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('RH_FUNCIONARIOS')
@RequirePermission(CODE)
@Controller()
export class EmployeePaymentsController {
  constructor(
    private readonly service: EmployeePaymentsService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  // Devolve o funcionário dono pra escrita reaproveitar na checagem de próprios dados.
  private async assertPaymentInScope(id: string): Promise<string> {
    const employeeId = await this.service.findEmployeeIdOf(id);
    await this.employeeScope.assertEmployeeInScope(CODE, employeeId, `Pagamento ${id} não encontrado`);
    return employeeId;
  }

  @Post('employees/:employeeId/payments')
  async create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeePaymentDto) {
    await this.employeeScope.assertEmployeeInScope(CODE, employeeId);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.create(employeeId, dto);
  }

  @Get('employees/:employeeId/payments')
  async findAllForEmployee(@Param('employeeId') employeeId: string, @Query() query: QueryEmployeePaymentsDto) {
    await this.employeeScope.assertEmployeeInScope(CODE, employeeId);
    return this.service.findAllForEmployee(employeeId, query);
  }

  @Get('employee-payments/:id')
  async findOne(@Param('id') id: string) {
    await this.assertPaymentInScope(id);
    return this.service.findOne(id);
  }

  @Patch('employee-payments/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateEmployeePaymentDto) {
    const employeeId = await this.assertPaymentInScope(id);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.update(id, dto);
  }

  @Patch('employee-payments/:id/pay')
  async pay(@Param('id') id: string) {
    const employeeId = await this.assertPaymentInScope(id);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.pay(id);
  }

  @Patch('employee-payments/:id/unpay')
  async unpay(@Param('id') id: string) {
    const employeeId = await this.assertPaymentInScope(id);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.unpay(id);
  }

  @Delete('employee-payments/:id')
  async remove(@Param('id') id: string) {
    const employeeId = await this.assertPaymentInScope(id);
    await this.employeeScope.assertCanWriteOwn(employeeId);
    return this.service.remove(id);
  }
}
