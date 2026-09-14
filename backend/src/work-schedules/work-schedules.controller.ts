import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { QueryWorkSchedulesDto } from './dto/query-work-schedules.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';
import { WorkSchedulesService } from './work-schedules.service';

// Mutação restrita a @Roles('ADMIN') em cada handler (não na classe): jornada
// é configuração de empresa, não delegada ao superior direto nesta etapa —
// decisão registrada aqui (não pré-aprovada na spec, que era silenciosa sobre
// este ponto), ver task-5-report.md. Leitura, ao contrário, é liberada também
// pro superior direto do funcionário-alvo via TimeManagementAuthService — daí
// não colocar @Roles('ADMIN') na classe inteira.
@UseGuards(ModulesGuard, RolesGuard)
@RequireModule('RH')
@Controller('work-schedules')
export class WorkSchedulesController {
  constructor(
    private readonly workSchedules: WorkSchedulesService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateWorkScheduleDto) {
    return this.workSchedules.create(dto);
  }

  // Sem `employeeId`: lista jornadas de toda a empresa, restrito a ADMIN. Com
  // `employeeId`: liberado também pro superior direto daquele funcionário
  // (TimeManagementAuthService.canManage) — ele precisa ver a jornada do
  // subordinado pra fazer sentido de qualquer inconsistência de ponto.
  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryWorkSchedulesDto) {
    if (query.employeeId) {
      await this.timeManagementAuth.assertCanManage(user, query.employeeId);
    } else if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Apenas administradores podem listar jornadas sem filtrar por funcionário');
    }
    return this.workSchedules.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const schedule = await this.workSchedules.findOne(id);
    await this.timeManagementAuth.assertCanManage(user, schedule.employeeId);
    return schedule;
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkScheduleDto) {
    return this.workSchedules.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.workSchedules.remove(id);
  }
}
