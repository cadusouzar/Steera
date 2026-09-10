import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateEmployeeWarningDto } from './dto/create-employee-warning.dto';
import { UpdateEmployeeWarningDto } from './dto/update-employee-warning.dto';
import { EmployeeWarningsService } from './employee-warnings.service';

@Controller()
export class EmployeeWarningsController {
  constructor(private readonly warningsService: EmployeeWarningsService) {}

  @Post('employees/:employeeId/warnings')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeeWarningDto) {
    return this.warningsService.create(employeeId, dto);
  }

  @Get('employees/:employeeId/warnings')
  findAllForEmployee(@Param('employeeId') employeeId: string) {
    return this.warningsService.findAllForEmployee(employeeId);
  }

  @Get('employees/:employeeId/warnings/:id')
  findOne(@Param('employeeId') employeeId: string, @Param('id') id: string) {
    return this.warningsService.findOne(id, employeeId);
  }

  @Patch('employees/:employeeId/warnings/:id')
  update(@Param('employeeId') employeeId: string, @Param('id') id: string, @Body() dto: UpdateEmployeeWarningDto) {
    return this.warningsService.update(id, employeeId, dto);
  }
}
