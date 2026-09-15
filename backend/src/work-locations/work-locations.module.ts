import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { WorkLocationsController } from './work-locations.controller';
import { WorkLocationsService } from './work-locations.service';

@Module({
  imports: [CompanyModule, TimeManagementAuthModule],
  controllers: [WorkLocationsController],
  providers: [WorkLocationsService],
  exports: [WorkLocationsService],
})
export class WorkLocationsModule {}
