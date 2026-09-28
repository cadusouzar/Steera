import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { EmployeeScopeService } from '../authorization/employee-scope.service';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
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

// Permissões por ação e alcance (Task 3): PermissionsGuard no nível de classe, ao lado do
// ModulesGuard (adiciona, nunca substitui). O ALCANCE (PROPRIO/EQUIPE/DEPARTAMENTO/EMPRESA) é
// aplicado aqui no controller, via EmployeeScopeService, e não dentro de EmployeesService: o
// serviço também é chamado internamente por pagamentos, advertências, férias, ponto etc., que
// respondem às suas próprias permissões e não podem herdar o alcance de funcionarios.ver.
@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('RH_FUNCIONARIOS')
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly timeManagementAuth: TimeManagementAuthService,
    private readonly timeClock: TimeClockService,
    private readonly calculation: TimeAttendanceCalculationService,
    private readonly employeeScope: EmployeeScopeService,
  ) {}

  @RequirePermission('funcionarios.gerenciar')
  @Post()
  async create(@Body() dto: CreateEmployeeDto) {
    return toEmployeeDetail(await this.employeesService.create(dto));
  }

  @RequirePermission('funcionarios.ver')
  @Get()
  async findAll(@Query() query: QueryEmployeesDto) {
    const scopeFilter = await this.employeeScope.whereEmployeeIn('funcionarios.ver');
    const { items, total, page, pageSize } = await this.employeesService.findAll(query, scopeFilter);
    return { items: items.map(toEmployeeListItem), total, page, pageSize };
  }

  // GET /:id devolve dado LGPD-sensível completo (CPF, dados bancários,
  // salário — mascarado/omitido da listagem de propósito, ver CLAUDE.md).
  // Checagem inline em vez de um guard/decorator novo (YAGNI — é o único
  // call site que precisa disso hoje): ADMIN sempre pode; um login EMPLOYEE
  // só pode se `RH_FUNCIONARIOS` estiver entre seus `modules` (é o caso
  // legítimo de um EMPLOYEE fazendo administração de RH, que este plano
  // passou a permitir pela primeira vez — RH virou RH_CARGOS/
  // RH_FUNCIONARIOS em 17/09/2026, ver o schema). Nunca gatear só por
  // ADMIN — quebraria esse uso legítimo.
  //
  // Fora do alcance de funcionarios.ver → 404 com a mesma mensagem de "não encontrado" do serviço,
  // checado ANTES de qualquer consulta (nunca revela que o funcionário existe).
  @RequirePermission('funcionarios.ver')
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (user.role !== 'ADMIN' && !user.modules?.includes('RH_FUNCIONARIOS')) {
      throw new ForbiddenException('Sem permissão para ver os dados completos deste funcionário');
    }
    await this.employeeScope.assertEmployeeInScope('funcionarios.ver', id);
    return toEmployeeDetail(await this.employeesService.findOne(id));
  }

  // Escritas: alcance de funcionarios.gerenciar checado antes de tocar o banco (fora → 404, sem escrita);
  // depois, na própria ficha, exige também funcionarios.proprios.gerenciar (403, ver EmployeeScopeService).
  @RequirePermission('funcionarios.gerenciar')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    await this.employeeScope.assertEmployeeInScope('funcionarios.gerenciar', id);
    await this.employeeScope.assertCanWriteOwn(id);
    return toEmployeeDetail(await this.employeesService.update(id, dto));
  }

  @RequirePermission('funcionarios.gerenciar')
  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    await this.employeeScope.assertEmployeeInScope('funcionarios.gerenciar', id);
    await this.employeeScope.assertCanWriteOwn(id);
    return toEmployeeDetail(await this.employeesService.deactivate(id));
  }

  @RequirePermission('funcionarios.gerenciar')
  @Patch(':id/reactivate')
  async reactivate(@Param('id') id: string) {
    await this.employeeScope.assertEmployeeInScope('funcionarios.gerenciar', id);
    await this.employeeScope.assertCanWriteOwn(id);
    return toEmployeeDetail(await this.employeesService.reactivate(id));
  }

  // Visões administrativas agregadas de ponto (Task 10) — pura composição sobre
  // TimeClockService/TimeAttendanceCalculationService, já prontos e já testados nas Tasks 6/7;
  // nenhuma lógica de negócio nova aqui. assertCanManage() de propósito ANTES de qualquer consulta
  // — 404 (nunca 403) pro alvo, mesmo padrão do resto do módulo de ponto.
  //
  // @RequireModule('PONTO_ADMINISTRACAO') aqui SOBRESCREVE o `RH_FUNCIONARIOS` de nível de classe
  // (ModulesGuard lê o método antes da classe, nunca combina os dois) — são visões de PONTO, não de
  // cadastro de funcionário, então pertencem ao módulo de Ponto desde 17/09/2026, mesmo estando
  // fisicamente aninhadas sob /employees por conveniência de rota.
  @RequireModule('PONTO_ADMINISTRACAO')
  @RequirePermission('ponto.administrar')
  @Get(':employeeId/time-events')
  async listTimeEvents(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryTimeEventsDto,
  ) {
    await this.timeManagementAuth.assertCanManage(user, employeeId);
    return this.timeClock.listForEmployeeAdmin(user, employeeId, query);
  }

  // Mesma sobrescrita de módulo do endpoint acima — ver o comentário lá.
  @RequireModule('PONTO_ADMINISTRACAO')
  @RequirePermission('ponto.administrar')
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
