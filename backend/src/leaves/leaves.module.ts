import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveSchedulesController } from './leave-schedules.controller';
import { LeaveSchedulesService } from './leave-schedules.service';

@Module({
  imports: [EmployeesModule, CompanyModule],
  controllers: [LeaveSchedulesController],
  providers: [LeaveSchedulesService],
})
export class LeavesModule {}
