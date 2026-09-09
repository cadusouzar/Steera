import { Module } from '@nestjs/common';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceivablesModule } from './receivables/receivables.module';

@Module({
  imports: [PrismaModule, ClientsModule, ReceivablesModule],
})
export class AppModule {}
