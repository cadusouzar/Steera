import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { TimeTrackingSettingsModule } from '../time-tracking-settings/time-tracking-settings.module';
import { WorkLocationsModule } from '../work-locations/work-locations.module';
import { TimeAttendanceCalculationService } from './time-attendance-calculation.service';
import { TimeClockController } from './time-clock.controller';
import { TimeClockService } from './time-clock.service';
import { TimeEventsAdminController } from './time-events-admin.controller';

@Module({
  imports: [FilesModule, TimeTrackingSettingsModule, WorkLocationsModule, TimeManagementAuthModule, HolidaysModule],
  controllers: [TimeClockController, TimeEventsAdminController],
  providers: [TimeClockService, TimeAttendanceCalculationService],
  exports: [TimeClockService, TimeAttendanceCalculationService],
})
export class TimeClockModule {}
