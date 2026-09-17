import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { TimeClockModule } from '../time-clock/time-clock.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [CompanyModule, CustomFieldsModule, TimeManagementAuthModule, TimeClockModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
