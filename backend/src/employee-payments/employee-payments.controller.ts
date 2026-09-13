import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreateEmployeePaymentDto } from './dto/create-employee-payment.dto';
import { QueryEmployeePaymentsDto } from './dto/query-employee-payments.dto';
import { UpdateEmployeePaymentDto } from './dto/update-employee-payment.dto';
import { EmployeePaymentsService } from './employee-payments.service';

@UseGuards(ModulesGuard)
@RequireModule('RH')
@Controller()
export class EmployeePaymentsController {
  constructor(private readonly service: EmployeePaymentsService) {}

  @Post('employees/:employeeId/payments')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeePaymentDto) {
    return this.service.create(employeeId, dto);
  }

  @Get('employees/:employeeId/payments')
  findAllForEmployee(@Param('employeeId') employeeId: string, @Query() query: QueryEmployeePaymentsDto) {
    return this.service.findAllForEmployee(employeeId, query);
  }

  @Get('employee-payments/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('employee-payments/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeePaymentDto) {
    return this.service.update(id, dto);
  }

  @Patch('employee-payments/:id/pay')
  pay(@Param('id') id: string) {
    return this.service.pay(id);
  }

  @Patch('employee-payments/:id/unpay')
  unpay(@Param('id') id: string) {
    return this.service.unpay(id);
  }

  @Delete('employee-payments/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
