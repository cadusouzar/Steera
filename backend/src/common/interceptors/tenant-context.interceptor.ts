import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, firstValueFrom, from } from 'rxjs';
import { runWithTenant } from '../../prisma/tenant-context';

/**
 * Establishes the per-request tenant context (see `prisma/tenant-context.ts`)
 * that the Prisma extension in `prisma/tenant-rls.extension.ts` turns into a
 * real, transaction-scoped Postgres `set_config('app.current_company_id', ...)`
 * call for every query the request makes — the application-layer half of the
 * RLS backstop.
 *
 * Registered as a global `APP_INTERCEPTOR`, deliberately NOT as Express
 * middleware: middleware runs BEFORE guards in Nest's request lifecycle,
 * which means `req.user` would not exist yet (JwtAuthGuard/JwtStrategy are
 * what populate it) — an interceptor runs AFTER guards, so `req.user` is
 * already set (or the route is `@Public()` and there is no user at all,
 * which this must handle without throwing).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const companyId = (request as { user?: { companyId?: string } }).user?.companyId;

    // No companyId (e.g. a @Public() route with no req.user at all, like
    // POST /auth/login before identity is known) — proceed without
    // establishing any tenant context. Queries made during this request will
    // pass straight through the Prisma extension unchanged (see its
    // "no tenant context at all" branch), which is exactly the safe default
    // for anonymous/pre-authentication requests: they get no elevated
    // cross-tenant access, they simply aren't tenant-scoped by this
    // mechanism at all (AuthService's own narrow `runAsSystem` calls handle
    // the few genuinely-necessary cross-tenant lookups on top of that).
    if (!companyId) {
      return next.handle();
    }

    // next.handle() returns an rxjs Observable (the NestJS interceptor
    // contract) — runWithTenant needs a Promise-returning callback so the
    // AsyncLocalStorage context stays active across every `await` inside the
    // controller/service call chain the Observable eventually triggers.
    // firstValueFrom is enough since Nest's request handler observables emit
    // exactly one value.
    return from(runWithTenant(companyId, () => firstValueFrom(next.handle())));
  }
}
