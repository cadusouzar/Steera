import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeeWarningsController } from './employee-warnings.controller';
import { EmployeeWarningsService } from './employee-warnings.service';

@Module({
  imports: [AuthorizationModule, EmployeesModule],
  controllers: [EmployeeWarningsController],
  providers: [EmployeeWarningsService],
})
export class EmployeeWarningsModule {}
