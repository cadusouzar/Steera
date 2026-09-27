import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { EmployeeScopeService } from '../authorization/employee-scope.service';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ScheduleLeaveDto } from './dto/schedule-leave.dto';
import { LeaveSchedulesService } from './leave-schedules.service';

// Permissões por ação e alcance (Task 4): mesma regra das férias — listar exige funcionarios.ver;
// agendar/cancelar/retomar exigem ferias.gerenciar, com o alcance dessa permissão. Rotas pelo id do
// agendamento respondem com o 404 do próprio agendamento quando o funcionário está fora do alcance,
// antes de qualquer escrita.
@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('RH_FUNCIONARIOS')
@Controller()
export class LeaveSchedulesController {
  constructor(
    private readonly service: LeaveSchedulesService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  private async assertScheduleInScope(id: string): Promise<void> {
    const employeeId = await this.service.findEmployeeIdOf(id);
    await this.employeeScope.assertEmployeeInScope('ferias.gerenciar', employeeId, `Agendamento de afastamento ${id} não encontrado`);
  }

  @RequirePermission('ferias.gerenciar')
  @Post('employees/:employeeId/leave/schedule')
  async schedule(@Param('employeeId') employeeId: string, @Body() dto: ScheduleLeaveDto) {
    await this.employeeScope.assertEmployeeInScope('ferias.gerenciar', employeeId);
    return this.service.schedule(employeeId, dto);
  }

  @RequirePermission('funcionarios.ver')
  @Get('employees/:employeeId/leave/schedules')
  async findAllForEmployee(@Param('employeeId') employeeId: string) {
    await this.employeeScope.assertEmployeeInScope('funcionarios.ver', employeeId);
    return this.service.findAllForEmployee(employeeId);
  }

  @RequirePermission('ferias.gerenciar')
  @Patch('leave-schedules/:id/cancel')
  async cancel(@Param('id') id: string) {
    await this.assertScheduleInScope(id);
    return this.service.cancel(id);
  }

  @RequirePermission('ferias.gerenciar')
  @Patch('leave-schedules/:id/resume')
  async resume(@Param('id') id: string) {
    await this.assertScheduleInScope(id);
    return this.service.resume(id);
  }
}
