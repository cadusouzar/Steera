import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { TimeClockService } from './time-clock.service';

// Sem prefixo de classe: GET /time-events/inconsistencies não é aninhado sob /employees/:id nem
// sob /time-clock — vive na própria raiz, por isso um controller dedicado em vez de forçar essa
// rota dentro de TimeClockController (que já tem prefixo de classe 'time-clock', e que
// deliberadamente NÃO exige o módulo RH — bater o próprio ponto é ação de "quem sou eu"). Esta
// rota É administrativa (mesmo espírito de EmployeesController), então exige RH.
@UseGuards(ModulesGuard)
@RequireModule('PONTO_ADMINISTRACAO')
@Controller()
export class TimeEventsAdminController {
  constructor(private readonly timeClock: TimeClockService) {}

  @Get('time-events/inconsistencies')
  listInconsistencies(@CurrentUser() user: AuthenticatedUser) {
    return this.timeClock.listInconsistencies(user);
  }
}
