import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { EmployeeScopeService } from '../authorization/employee-scope.service';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CreateEmployeeWarningDto } from './dto/create-employee-warning.dto';
import { UpdateEmployeeWarningDto } from './dto/update-employee-warning.dto';
import { EmployeeWarningsService } from './employee-warnings.service';

// Permissões por ação e alcance (Task 4): leitura exige funcionarios.ver, escrita exige
// advertencias.gerenciar. Toda rota é aninhada sob employees/:employeeId, então o alcance da
// permissão exigida é checado nesse employeeId ANTES do serviço (fora do alcance → 404, sem
// consulta nem escrita). Mesmo padrão de EmployeesController.
@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('RH_FUNCIONARIOS')
@Controller()
export class EmployeeWarningsController {
  constructor(
    private readonly warningsService: EmployeeWarningsService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  @RequirePermission('advertencias.gerenciar')
  @Post('employees/:employeeId/warnings')
  async create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeeWarningDto) {
    await this.employeeScope.assertEmployeeInScope('advertencias.gerenciar', employeeId);
    return this.warningsService.create(employeeId, dto);
  }

  @RequirePermission('funcionarios.ver')
  @Get('employees/:employeeId/warnings')
  async findAllForEmployee(@Param('employeeId') employeeId: string) {
    await this.employeeScope.assertEmployeeInScope('funcionarios.ver', employeeId);
    return this.warningsService.findAllForEmployee(employeeId);
  }

  @RequirePermission('funcionarios.ver')
  @Get('employees/:employeeId/warnings/:id')
  async findOne(@Param('employeeId') employeeId: string, @Param('id') id: string) {
    await this.employeeScope.assertEmployeeInScope('funcionarios.ver', employeeId);
    return this.warningsService.findOne(id, employeeId);
  }

  @RequirePermission('advertencias.gerenciar')
  @Patch('employees/:employeeId/warnings/:id')
  async update(@Param('employeeId') employeeId: string, @Param('id') id: string, @Body() dto: UpdateEmployeeWarningDto) {
    await this.employeeScope.assertEmployeeInScope('advertencias.gerenciar', employeeId);
    return this.warningsService.update(id, employeeId, dto);
  }
}
