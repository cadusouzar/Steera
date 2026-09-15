import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TimeManagementAuthService } from './time-management-auth.service';
import { TimeManagementController } from './time-management.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TimeManagementController],
  providers: [TimeManagementAuthService],
  exports: [TimeManagementAuthService],
})
export class TimeManagementAuthModule {}
