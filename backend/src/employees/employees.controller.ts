import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { toEmployeeDetail, toEmployeeListItem } from './employee-response.mapper';
import { EmployeesService } from './employees.service';

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

  @Get(':id')
  async findOne(@Param('id') id: string) {
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
