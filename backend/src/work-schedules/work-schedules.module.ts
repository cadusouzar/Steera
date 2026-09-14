import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { WorkSchedulesController } from './work-schedules.controller';
import { WorkSchedulesService } from './work-schedules.service';

@Module({
  imports: [CompanyModule, TimeManagementAuthModule],
  controllers: [WorkSchedulesController],
  providers: [WorkSchedulesService],
  exports: [WorkSchedulesService],
})
export class WorkSchedulesModule {}
