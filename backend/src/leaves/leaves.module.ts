import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveSchedulesController } from './leave-schedules.controller';
import { LeaveSchedulesService } from './leave-schedules.service';

@Module({
  imports: [AuthorizationModule, EmployeesModule, CompanyModule],
  controllers: [LeaveSchedulesController],
  providers: [LeaveSchedulesService],
})
export class LeavesModule {}
