import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TimeManagementAuthService } from './time-management-auth.service';

@Module({
  imports: [PrismaModule],
  providers: [TimeManagementAuthService],
  exports: [TimeManagementAuthService],
})
export class TimeManagementAuthModule {}
