import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { TimeTrackingSettingsController } from './time-tracking-settings.controller';
import { TimeTrackingSettingsService } from './time-tracking-settings.service';

@Module({
  imports: [CompanyModule],
  controllers: [TimeTrackingSettingsController],
  providers: [TimeTrackingSettingsService],
  exports: [TimeTrackingSettingsService],
})
export class TimeTrackingSettingsModule {}
