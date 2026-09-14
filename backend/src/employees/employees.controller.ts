import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { QueryTimeEventsDto } from '../time-clock/dto/query-time-events.dto';
import { TimeAttendanceCalculationService } from '../time-clock/time-attendance-calculation.service';
import { TimeClockService } from '../time-clock/time-clock.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { toEmployeeDetail, toEmployeeListItem } from './employee-response.mapper';
import { EmployeesService } from './employees.service';

@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly timeManagementAuth: TimeManagementAuthService,
    private readonly timeClock: TimeClockService,
    private readonly calculation: TimeAttendanceCalculationService,
  ) {}

  @Post()
  async create(@Body() dto: CreateEmployeeDto) {
    return toEmployeeDetail(await this.employeesService.create(dto));
  }

  @Get()
  async findAll(@Query() query: QueryEmployeesDto) {
    const { items, total, page, pageSize } = await this.employeesService.findAll(query);
    return { items: items.map(toEmployeeListItem), total, page, pageSize };
  }

  // GET /:id devolve dado LGPD-sensível completo (CPF, dados bancários,
  // salário — mascarado/omitido da listagem de propósito, ver CLAUDE.md).
  // Checagem inline em vez de um guard/decorator novo (YAGNI — é o único
  // call site que precisa disso hoje): ADMIN sempre pode; um login EMPLOYEE
  // só pode se `RH` estiver entre seus `modules` (é o caso legítimo de um
  // EMPLOYEE fazendo administração de RH, que este plano passou a permitir
  // pela primeira vez). Nunca gatear só por ADMIN — quebraria esse uso
  // legítimo.
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (user.role !== 'ADMIN' && !user.modules?.includes('RH')) {
      throw new ForbiddenException('Sem permissão para ver os dados completos deste funcionário');
    }
    return toEmployeeDetail(await this.employeesService.findOne(id));
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return toEmployeeDetail(await this.employeesService.update(id, dto));
  }

  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    return toEmployeeDetail(await this.employeesService.deactivate(id));
  }

  @Patch(':id/reactivate')
  async reactivate(@Param('id') id: string) {
    return toEmployeeDetail(await this.employeesService.reactivate(id));
  }

  // Visões administrativas agregadas de ponto (Task 10) — pura composição sobre
  // TimeClockService/TimeAttendanceCalculationService, já prontos e já testados nas Tasks 6/7;
  // nenhuma lógica de negócio nova aqui. assertCanManage() de propósito ANTES de qualquer consulta
  // — 404 (nunca 403) pro alvo, mesmo padrão do resto do módulo de ponto.
  @Get(':employeeId/time-events')
  async listTimeEvents(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryTimeEventsDto,
  ) {
    await this.timeManagementAuth.assertCanManage(user, employeeId);
    return this.timeClock.listForEmployeeAdmin(user, employeeId, query);
  }

  @Get(':employeeId/time-summary')
  async timeSummary(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    await this.timeManagementAuth.assertCanManage(user, employeeId);
    const numericYear = Number(year);
    const numericMonth = Number(month);
    if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
      throw new BadRequestException('Parâmetros year/month inválidos');
    }
    return this.calculation.calculateMonthlySummary(employeeId, numericYear, numericMonth);
  }
}
