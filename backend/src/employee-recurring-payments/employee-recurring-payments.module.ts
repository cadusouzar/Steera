import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeeRecurringPaymentsController } from './employee-recurring-payments.controller';
import { EmployeeRecurringPaymentsService } from './employee-recurring-payments.service';

@Module({
  imports: [EmployeesModule, CompanyModule],
  controllers: [EmployeeRecurringPaymentsController],
  providers: [EmployeeRecurringPaymentsService],
})
export class EmployeeRecurringPaymentsModule {}
