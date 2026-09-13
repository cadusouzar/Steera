import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { toEmployeeDetail, toEmployeeListItem } from './employee-response.mapper';
import { EmployeesService } from './employees.service';

@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

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
}
