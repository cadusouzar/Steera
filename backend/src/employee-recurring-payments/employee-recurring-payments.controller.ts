import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateEmployeeRecurringPaymentDto } from './dto/create-employee-recurring-payment.dto';
import { UpdateEmployeeRecurringPaymentDto } from './dto/update-employee-recurring-payment.dto';
import { EmployeeRecurringPaymentsService } from './employee-recurring-payments.service';

@Controller()
export class EmployeeRecurringPaymentsController {
  constructor(private readonly service: EmployeeRecurringPaymentsService) {}

  @Post('employees/:employeeId/recurring-payments')
  create(@Param('employeeId') employeeId: string, @Body() dto: CreateEmployeeRecurringPaymentDto) {
    return this.service.create(employeeId, dto);
  }

  @Get('employees/:employeeId/recurring-payments')
  findAllForEmployee(@Param('employeeId') employeeId: string) {
    return this.service.findAllForEmployee(employeeId);
  }

  @Get('employee-recurring-payments/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('employee-recurring-payments/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeRecurringPaymentDto) {
    return this.service.update(id, dto);
  }

  @Delete('employee-recurring-payments/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('employee-recurring-payments/:id/generate-charge')
  generateCharge(@Param('id') id: string) {
    return this.service.generateCharge(id);
  }
}
