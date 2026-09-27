import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { EmployeeScopeService } from '../authorization/employee-scope.service';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ResumeVacationDto } from './dto/resume-vacation.dto';
import { ScheduleVacationDto } from './dto/schedule-vacation.dto';
import { VacationSchedulesService } from './vacation-schedules.service';

// Permissões por ação e alcance (Task 4): listar exige funcionarios.ver; agendar/cancelar/retomar
// exigem ferias.gerenciar. O alcance usado é sempre o da permissão da rota. Rotas pelo id do
// agendamento descobrem o funcionário dono primeiro e, fora do alcance, respondem com o MESMO 404
// de um agendamento inexistente, antes de qualquer escrita.
@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('RH_FUNCIONARIOS')
@Controller()
export class VacationSchedulesController {
  constructor(
    private readonly service: VacationSchedulesService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  private async assertScheduleInScope(id: string): Promise<void> {
    const employeeId = await this.service.findEmployeeIdOf(id);
    await this.employeeScope.assertEmployeeInScope('ferias.gerenciar', employeeId, `Agendamento de férias ${id} não encontrado`);
  }

  @RequirePermission('ferias.gerenciar')
  @Post('employees/:employeeId/vacation/schedule')
  async schedule(@Param('employeeId') employeeId: string, @Body() dto: ScheduleVacationDto) {
    await this.employeeScope.assertEmployeeInScope('ferias.gerenciar', employeeId);
    return this.service.schedule(employeeId, dto);
  }

  @RequirePermission('funcionarios.ver')
  @Get('employees/:employeeId/vacation/schedules')
  async findAllForEmployee(@Param('employeeId') employeeId: string) {
    await this.employeeScope.assertEmployeeInScope('funcionarios.ver', employeeId);
    return this.service.findAllForEmployee(employeeId);
  }

  @RequirePermission('ferias.gerenciar')
  @Patch('vacation-schedules/:id/cancel')
  async cancel(@Param('id') id: string) {
    await this.assertScheduleInScope(id);
    return this.service.cancel(id);
  }

  @RequirePermission('ferias.gerenciar')
  @Patch('vacation-schedules/:id/resume')
  async resume(@Param('id') id: string, @Body() dto: ResumeVacationDto) {
    await this.assertScheduleInScope(id);
    return this.service.resume(id, dto);
  }
}
