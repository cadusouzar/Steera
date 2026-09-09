import { Module } from '@nestjs/common';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { ReportsModule } from './reports/reports.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [PrismaModule, ClientsModule, ReceivablesModule, SubscriptionsModule, ReportsModule],
})
export class AppModule {}
