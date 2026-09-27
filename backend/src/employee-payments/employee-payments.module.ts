import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeePaymentsController } from './employee-payments.controller';
import { EmployeePaymentsService } from './employee-payments.service';

@Module({
  imports: [AuthorizationModule, EmployeesModule, CompanyModule],
  controllers: [EmployeePaymentsController],
  providers: [EmployeePaymentsService],
})
export class EmployeePaymentsModule {}
