import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { TimeManagementAuthService } from './time-management-auth.service';

// Rota administrativa (mesmo espírito de EmployeesController/TimeEventsAdminController) — exige RH.
@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller('time-management')
export class TimeManagementController {
  constructor(private readonly timeManagementAuth: TimeManagementAuthService) {}

  @Get('manageable-employees')
  listManageableEmployees(@CurrentUser() user: AuthenticatedUser) {
    return this.timeManagementAuth.listManageableEmployees(user);
  }

  // Endpoint próprio (em vez de mudar o formato de resposta de manageable-employees, consumido em
  // 3 lugares do frontend): "eu tenho um time PRÓPRIO?" é uma pergunta diferente de "quem eu posso
  // administrar?" — pra um ADMIN de acesso total a segunda devolve a empresa inteira. Ver
  // TimeManagementAuthService.hasDirectReports.
  @Get('has-direct-reports')
  async hasDirectReports(@CurrentUser() user: AuthenticatedUser) {
    return { hasDirectReports: await this.timeManagementAuth.hasDirectReports(user) };
  }
}
