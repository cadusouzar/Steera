import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { TimeAdjustmentsController } from './time-adjustments.controller';
import { TimeAdjustmentsService } from './time-adjustments.service';

@Module({
  imports: [FilesModule, TimeManagementAuthModule],
  controllers: [TimeAdjustmentsController],
  providers: [TimeAdjustmentsService],
  exports: [TimeAdjustmentsService],
})
export class TimeAdjustmentsModule {}
