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
}
