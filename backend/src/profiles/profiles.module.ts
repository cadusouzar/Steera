import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TimeManagementAuthModule } from '../time-management/time-management-auth.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [PrismaModule, TimeManagementAuthModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
