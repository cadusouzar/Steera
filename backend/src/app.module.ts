import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { CompanyModule } from './company/company.module';
import { RolesModule } from './roles/roles.module';
import { EmployeesModule } from './employees/employees.module';
import { EmployeeWarningsModule } from './employee-warnings/employee-warnings.module';
import { EmployeeRecurringPaymentsModule } from './employee-recurring-payments/employee-recurring-payments.module';
import { EmployeePaymentsModule } from './employee-payments/employee-payments.module';
import { VacationsModule } from './vacations/vacations.module';
import { LeavesModule } from './leaves/leaves.module';
import { BillingModule } from './billing/billing.module';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { ReportsModule } from './reports/reports.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

@Module({
  imports: [
    // Must come first: loads backend/.env into process.env before PrismaService
    // (and anything else reading DATABASE_URL) is instantiated.
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Limite padrão de 5 requisições a cada 15 min. Não é registrado como
    // APP_GUARD global — só o AuthController aplica ThrottlerGuard
    // explicitamente (ver auth.controller.ts), pra não limitar rotas de
    // RH/Financeiro sem necessidade.
    ThrottlerModule.forRoot([{ ttl: 900_000, limit: 5 }]),
    PrismaModule,
    AuthModule,
    CompanyModule,
    RolesModule,
    EmployeesModule,
    EmployeeWarningsModule,
    EmployeeRecurringPaymentsModule,
    EmployeePaymentsModule,
    VacationsModule,
    LeavesModule,
    BillingModule,
    ClientsModule,
    ReceivablesModule,
    SubscriptionsModule,
    ReportsModule,
  ],
  providers: [
    // JwtAuthGuard já respeita @Public() (Task 3) — nega por padrão em toda
    // rota nova ou existente, sem precisar visitar/anotar cada controller.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
