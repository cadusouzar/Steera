import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateTimeTrackingSettingsDto } from './dto/update-time-tracking-settings.dto';
import { TimeTrackingSettingsService } from './time-tracking-settings.service';

// Leitura liberada pra qualquer login com módulo RH (o frontend do próprio
// funcionário precisa saber se foto/localização são obrigatórias antes de
// bater o ponto); mutação restrita a ADMIN.
@UseGuards(ModulesGuard, RolesGuard)
@RequireModule('RH')
@Controller('time-tracking-settings')
export class TimeTrackingSettingsController {
  constructor(private readonly settings: TimeTrackingSettingsService) {}

  @Get()
  findOne() {
    return this.settings.getCurrent();
  }

  @Roles('ADMIN')
  @Patch()
  update(@Body() dto: UpdateTimeTrackingSettingsDto) {
    return this.settings.update(dto);
  }
}
