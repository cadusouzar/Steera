import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { THROTTLERS } from './app-throttlers';
import { AuthModule } from './auth/auth.module';
import { EmailVerifiedGuard } from './auth/guards/email-verified.guard';
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
    // (nunca por IP — ver login-throttle.util.ts), usado hoje só em POST
    // /auth/forgot-password (3/15min por e-mail, pra ninguém inundar a caixa
    // de entrada de uma conta). Todas as outras rotas com throttle pulam esse
    // nome via @SkipThrottle — inclusive POST /auth/login desde 26/09/2026
    // ("Acesso e sessões", fix round 1): lá ele rodava antes do handler e
    // contava login CERTO também; a contagem por e-mail do login agora vive
    // em AuthService.login, que só conta falhas. O valor usado em runtime vem
    // do @Throttle({'login-email': {...}}) de cada handler; este aqui é o
    // mínimo pra esse nome existir em `this.throttlers` do guard.
    //
    // "refresh-ip" (fix final): teto secundário por IP só em POST /auth/refresh — ver
    // app-throttlers.ts, onde a lista mora (compartilhada com o teste do throttler real).
    ThrottlerModule.forRoot(THROTTLERS),
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
    // Confirmação de e-mail do fundador: logo depois do JwtAuthGuard (precisa de req.user) e antes
    // do PlanGuard — enquanto o e-mail não for confirmado, só as rotas @AllowUnverifiedEmail()/
    // @Public() passam (ver email-verified.guard.ts).
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },
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
