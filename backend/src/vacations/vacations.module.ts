import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { EmployeesModule } from '../employees/employees.module';
import { VacationSchedulesController } from './vacation-schedules.controller';
import { VacationSchedulesService } from './vacation-schedules.service';

@Module({
  imports: [EmployeesModule, CompanyModule],
  controllers: [VacationSchedulesController],
  providers: [VacationSchedulesService],
})
export class VacationsModule {}
