import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { EmployeeWarningsController } from './employee-warnings.controller';
import { EmployeeWarningsService } from './employee-warnings.service';

@Module({
  imports: [EmployeesModule],
  controllers: [EmployeeWarningsController],
  providers: [EmployeeWarningsService],
})
export class EmployeeWarningsModule {}
