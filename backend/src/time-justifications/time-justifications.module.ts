import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { TimeJustificationsController } from './time-justifications.controller';
import { TimeJustificationsService } from './time-justifications.service';

@Module({
  imports: [FilesModule, TimeManagementAuthModule],
  controllers: [TimeJustificationsController],
  providers: [TimeJustificationsService],
  exports: [TimeJustificationsService],
})
export class TimeJustificationsModule {}
