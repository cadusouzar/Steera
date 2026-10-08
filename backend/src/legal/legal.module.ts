import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LegalAcceptanceService } from './legal-acceptance.service';

@Module({
  imports: [PrismaModule],
  providers: [LegalAcceptanceService],
  exports: [LegalAcceptanceService],
})
export class LegalModule {}
