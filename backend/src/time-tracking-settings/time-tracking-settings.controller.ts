import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { QueryTimeTrackingSettingsDto } from './dto/query-time-tracking-settings.dto';
import { UpdateTimeTrackingSettingsDto } from './dto/update-time-tracking-settings.dto';
import { TimeTrackingSettingsService } from './time-tracking-settings.service';

// Mutação não é mais @Roles('ADMIN') puro — TimeTrackingSettingsService decide por tier (padrão da
// empresa exige hasFullPontoAccess; sobrescrita de time é autoatendimento ou exige acesso total
// pra mexer na de outro superior). RolesGuard removido desta classe.
@UseGuards(ModulesGuard)
@RequireModule('PONTO_ADMINISTRACAO')
@Controller('time-tracking-settings')
export class TimeTrackingSettingsController {
  constructor(private readonly settings: TimeTrackingSettingsService) {}

  @Get()
  findOne(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryTimeTrackingSettingsDto) {
    return this.settings.getScoped(query.managerId, user);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateTimeTrackingSettingsDto) {
    return this.settings.update(dto, user);
  }
}
