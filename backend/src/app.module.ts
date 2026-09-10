import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompanyModule } from './company/company.module';
import { RolesModule } from './roles/roles.module';
import { EmployeesModule } from './employees/employees.module';
import { EmployeeWarningsModule } from './employee-warnings/employee-warnings.module';
import { EmployeeRecurringPaymentsModule } from './employee-recurring-payments/employee-recurring-payments.module';
import { EmployeePaymentsModule } from './employee-payments/employee-payments.module';
import { VacationsModule } from './vacations/vacations.module';
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
    PrismaModule,
    CompanyModule,
    RolesModule,
    EmployeesModule,
    EmployeeWarningsModule,
    EmployeeRecurringPaymentsModule,
    EmployeePaymentsModule,
    VacationsModule,
    ClientsModule,
    ReceivablesModule,
    SubscriptionsModule,
    ReportsModule,
  ],
})
export class AppModule {}
