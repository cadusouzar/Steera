import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { QueryWorkSchedulesDto } from './dto/query-work-schedules.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';
import { WorkSchedulesService } from './work-schedules.service';

// Mutação não é mais @Roles('ADMIN') puro — WorkSchedulesService.assertValidTierAndAuthorized
// decide por camada (empresa exige hasFullPontoAccess; time exige ser o próprio superior ou ter
// hasFullPontoAccess; individual exige assertCanManage). RolesGuard não é mais usado aqui.
@UseGuards(ModulesGuard)
@RequireModule('PONTO_ADMINISTRACAO')
@Controller('work-schedules')
export class WorkSchedulesController {
  constructor(
    private readonly workSchedules: WorkSchedulesService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkScheduleDto) {
    return this.workSchedules.create(dto, user);
  }

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryWorkSchedulesDto) {
    if (query.employeeId) {
      await this.timeManagementAuth.assertCanManage(user, query.employeeId);
    } else if (query.managerId) {
      // Ver o padrão de time de um superior específico: qualquer um pode ver o PRÓPRIO; ver o de
      // outro exige acesso total — mesma regra de quem pode CRIAR um.
      const ownEmployee = await this.timeManagementAuth.resolveOwnEmployee(user).catch(() => null);
      if (ownEmployee?.id !== query.managerId) this.timeManagementAuth.assertHasFullPontoAccess(user);
    } else {
      // Sem nenhum filtro: mesma regra da camada "empresa inteira" de assertValidTierAndAuthorized
      // — 404, nunca 403, mesmo padrão de negação de todo o resto do backend (ver findOne abaixo).
      this.timeManagementAuth.assertHasFullPontoAccess(user);
    }
    return this.workSchedules.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const schedule = await this.workSchedules.findOne(id);
    if (schedule.employeeId) {
      await this.timeManagementAuth.assertCanManage(user, schedule.employeeId);
    } else if (schedule.managerId) {
      const currentUserRecord = await this.timeManagementAuth.resolveOwnEmployee(user).catch(() => null);
      if (currentUserRecord?.id !== schedule.managerId) this.timeManagementAuth.assertHasFullPontoAccess(user);
    } else {
      this.timeManagementAuth.assertHasFullPontoAccess(user);
    }
    return schedule;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkScheduleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workSchedules.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workSchedules.remove(id, user);
  }
}
