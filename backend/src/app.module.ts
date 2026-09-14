import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { CompanyModule } from './company/company.module';
import { RolesModule } from './roles/roles.module';
import { EmployeesModule } from './employees/employees.module';
import { EmployeeWarningsModule } from './employee-warnings/employee-warnings.module';
import { EmployeeRecurringPaymentsModule } from './employee-recurring-payments/employee-recurring-payments.module';
import { EmployeePaymentsModule } from './employee-payments/employee-payments.module';
import { VacationsModule } from './vacations/vacations.module';
import { LeavesModule } from './leaves/leaves.module';
import { HolidaysModule } from './holidays/holidays.module';
import { BillingModule } from './billing/billing.module';
import { ClientsModule } from './clients/clients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReceivablesModule } from './receivables/receivables.module';
import { ReportsModule } from './reports/reports.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UsersModule } from './users/users.module';
import { WorkSchedulesModule } from './work-schedules/work-schedules.module';
import { WorkLocationsModule } from './work-locations/work-locations.module';
import { TimeTrackingSettingsModule } from './time-tracking-settings/time-tracking-settings.module';
import { TimeClockModule } from './time-clock/time-clock.module';
import { TimeAdjustmentsModule } from './time-adjustments/time-adjustments.module';
import { TimeJustificationsModule } from './time-justifications/time-justifications.module';

@Module({
  imports: [
    // Must come first: loads backend/.env into process.env before PrismaService
    // (and anything else reading DATABASE_URL) is instantiated.
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Limite padrão de 5 requisições a cada 15 min, por IP (throttler
    // "default"). Não é registrado como APP_GUARD global — só o
    // AuthController aplica ThrottlerGuard explicitamente (ver
    // auth.controller.ts), pra não limitar rotas de RH/Financeiro sem
    // necessidade.
    //
    // "login-email" é um segundo throttler nomeado, keyed só por e-mail
    // (nunca por IP — ver login-throttle.util.ts), usado só em POST
    // /auth/login pra fechar a lacuna de um atacante que faz brute-force de
    // UM e-mail conhecido rotacionando IPs (o throttler "default" sozinho
    // não pega isso, já que cada IP novo começa com um bucket zerado).
    // register()/refresh() pulam esse throttler via @SkipThrottle — register
    // cria um recurso novo a cada request (rastreio por e-mail não faz
    // sentido do mesmo jeito) e refresh não tem e-mail no corpo. O limite
    // aqui é o mesmo do "default" (5/15min) só por consistência com o valor
    // já usado nesta mesma spec ("5 tentativas/15 min") — o valor de fato
    // usado em runtime vem do @Throttle({'login-email': {...}}) no handler
    // de login, este aqui é só o "existir" mínimo exigido pra esse nome
    // aparecer em `this.throttlers` do guard.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 900_000, limit: 5 },
      { name: 'login-email', ttl: 900_000, limit: 5 },
    ]),
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
    HolidaysModule,
    BillingModule,
    ClientsModule,
    ReceivablesModule,
    SubscriptionsModule,
    ReportsModule,
    UsersModule,
    WorkSchedulesModule,
    WorkLocationsModule,
    TimeTrackingSettingsModule,
    TimeClockModule,
    TimeAdjustmentsModule,
    TimeJustificationsModule,
  ],
  providers: [
    // JwtAuthGuard já respeita @Public() (Task 3) — nega por padrão em toda
    // rota nova ou existente, sem precisar visitar/anotar cada controller.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Backstop de RLS (defesa em profundidade): estabelece o contexto de
    // tenant (companyId autenticado) usado pela extensão do Prisma em
    // prisma/tenant-rls.extension.ts para escopar toda query por empresa a
    // nível de banco. Precisa ser um Interceptor (roda DEPOIS das guards,
    // quando req.user já existe), nunca um middleware Express (rodaria
    // ANTES das guards). Ver tenant-context.interceptor.ts.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
