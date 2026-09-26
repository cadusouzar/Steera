import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PlanGuard } from './plans/plan.guard';
import { PlansModule } from './plans/plans.module';
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
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
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
import { TenantMigrationModule } from './tenant-migration/tenant-migration.module';
import { ProfilesModule } from './profiles/profiles.module';
import { EmailModule } from './email/email.module';
import { UserTokensModule } from './auth/user-tokens/user-tokens.module';

@Module({
  imports: [
    // Must come first: loads backend/.env into process.env before PrismaService
    // (and anything else reading DATABASE_URL) is instantiated.
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Limite padrão de 5 requisições a cada 15 min, por IP (throttler
    // "default"). Não é registrado como APP_GUARD global — só as rotas que
    // precisam aplicam o guard explicitamente (ver auth.controller.ts), pra
    // não limitar rotas de RH/Financeiro sem necessidade. Cada handler
    // sobrescreve limite/ttl/tracker via @Throttle({...}).
    //
    // "login-email" é um segundo throttler nomeado, keyed só por e-mail
    // (nunca por IP — ver login-throttle.util.ts), usado só em POST
    // /auth/login pra fechar a lacuna de um atacante que faz brute-force de
    // UM e-mail conhecido rotacionando IPs. Todas as outras rotas com
    // throttle pulam esse nome via @SkipThrottle. O valor usado em runtime
    // vem do @Throttle({'login-email': {...}}) do login (5/15min, bloqueio de
    // 15min); este aqui é o mínimo pra esse nome existir em
    // `this.throttlers` do guard. setHeaders: false ("Acesso e sessões",
    // 26/09/2026): quando esse throttler estoura, LoginThrottlerGuard responde
    // o mesmo 403 da trava de conta real (AuthService.login) — um cabeçalho
    // Retry-After-login-email/X-RateLimit-*-login-email só existiria num dos
    // dois caminhos e denunciaria qual respondeu (anti-enumeração).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 900_000, limit: 5 },
      { name: 'login-email', ttl: 900_000, limit: 5, setHeaders: false },
    ]),
    PrismaModule,
    EmailModule,
    AuthModule,
    UserTokensModule,
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
    CustomFieldsModule,
    ReceivablesModule,
    SubscriptionsModule,
    ReportsModule,
    UsersModule,
    ProfilesModule,
    WorkSchedulesModule,
    WorkLocationsModule,
    TimeTrackingSettingsModule,
    TimeClockModule,
    TimeAdjustmentsModule,
    TimeJustificationsModule,
    TenantMigrationModule,
    PlansModule,
  ],
  providers: [
    // JwtAuthGuard já respeita @Public() (Task 3) — nega por padrão em toda
    // rota nova ou existente, sem precisar visitar/anotar cada controller.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Teto de PLANO da empresa: roda logo depois do JwtAuthGuard (APP_GUARDs
    // executam na ordem de registro), barrando @RequireModule(...) fora do
    // plano contratado (ver plan.guard.ts) — ortogonal ao ModulesGuard, que
    // segue sendo a permissão da PESSOA dentro do módulo.
    { provide: APP_GUARD, useClass: PlanGuard },
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
