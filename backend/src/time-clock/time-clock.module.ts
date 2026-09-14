import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { TimeTrackingSettingsModule } from '../time-tracking-settings/time-tracking-settings.module';
import { WorkLocationsModule } from '../work-locations/work-locations.module';
import { TimeClockController } from './time-clock.controller';
import { TimeClockService } from './time-clock.service';

@Module({
  imports: [FilesModule, TimeTrackingSettingsModule, WorkLocationsModule, TimeManagementAuthModule],
  controllers: [TimeClockController],
  providers: [TimeClockService],
  exports: [TimeClockService],
})
export class TimeClockModule {}
