import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { TimeTrackingSettingsController } from './time-tracking-settings.controller';
import { TimeTrackingSettingsService } from './time-tracking-settings.service';

@Module({
  imports: [CompanyModule, TimeManagementAuthModule],
  controllers: [TimeTrackingSettingsController],
  providers: [TimeTrackingSettingsService],
  exports: [TimeTrackingSettingsService],
})
export class TimeTrackingSettingsModule {}
