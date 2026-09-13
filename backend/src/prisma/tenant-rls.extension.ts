import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantStore, runInsideExplicitTenantTransaction } from './tenant-context';

/**
 * Database-level Row-Level Security backstop — see the RLS migration
 * (`prisma/migrations/*_enable_row_level_security`) for the Postgres side of
 * this. This extension is the application-layer half: it is what actually
 * turns the per-request tenant context (`tenant-context.ts`) into a real
 * Postgres session variable the RLS policies read.
 *
 * THE SINGLE MOST IMPORTANT CORRECTNESS PROPERTY HERE: `set_config(key,
 * value, true)` — note the `true` (= "local to the current transaction") —
 * is called INSIDE an actual database transaction for every query, so
 * Postgres resets it automatically the instant that transaction ends. A
 * plain `SET` (or `set_config(..., false)`) would persist for the lifetime
 * of the pooled physical connection, not the logical request, and could leak
 * one company's tenant id onto a totally unrelated later request that
 * happens to reuse the same pooled connection. Do not "simplify" this.
 *
 * Two distinct code paths need this, and they must NOT double up:
 *
 * 1. A plain, standalone call like `prisma.client.findFirst(...)` has no
 *    transaction of its own — this extension's `$allOperations` hook wraps
 *    it in a fresh two-statement transaction: `[set_config, the real query]`.
 *
 * 2. A handful of existing services already use `prisma.$transaction([...])`
 *    (array form) or `prisma.$transaction(async (tx) => {...})` (interactive
 *    form) for their OWN atomicity needs (e.g. `UsersService.block`). Those
 *    call sites use `runTenantTransaction`/`runTenantInteractiveTransaction`
 *    below instead of calling `prisma.$transaction` directly — those helpers
 *    set the tenant config as the FIRST statement of the SAME transaction
 *    and mark the async context as `insideExplicitTx`, so this extension's
 *    `$allOperations` hook (which fires for every model operation inside
 *    that transaction too, since extensions carry over to `tx`) sees the
 *    flag and passes the query straight through instead of opening a SECOND,
 *    separate transaction around it.
 *
 *    This matters a lot: wrapping each member of an already-atomic
 *    transaction in its own separate mini-transaction breaks the atomicity
 *    guarantee the original code relied on (verified empirically during
 *    development — an outer transaction whose second statement fails no
 *    longer rolls back the first one). See the RLS report for the
 *    reproduction.
 *
 * When no tenant context is set at all (migrations, health checks, the
 * narrow pre-authentication paths in AuthService that use `runAsSystem`,
 * this project's own e2e-test setup/teardown code) the query is passed
 * through completely unchanged — no wrapping, no forced empty context. This
 * is what keeps existing tooling working exactly as before.
 */
export function tenantRlsExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'tenant-rls',
    query: {
      // $allModels (not the top-level $allOperations) — this only fires for
      // actual model CRUD operations (findMany, create, update, ...), never
      // for `$queryRaw`/`$executeRaw` or `$transaction` itself. That's
      // exactly what we want: the raw `set_config` calls this extension (and
      // the transaction helpers below) issue via `$executeRaw` never
      // recurse back into this same hook.
      $allModels: {
        async $allOperations({ args, query }) {
          const store = getTenantStore();

          // No tenant context at all (migrations/health-checks/system code
          // that never called runWithTenant/runAsSystem) — or already inside
          // an explicit transaction that set the config itself. Either way,
          // pass through unchanged.
          if (!store || store.insideExplicitTx) return query(args);
          if (!store.companyId && !store.bypass) return query(args);

          const setConfigStatement = store.bypass
            ? base.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`
            : base.$executeRaw`SELECT set_config('app.current_company_id', ${store.companyId}, true)`;

          // Array-form $transaction batches every member into ONE physical
          // Postgres transaction (BEGIN ... COMMIT) — this is what makes the
          // `true` (LOCAL) scope of set_config actually apply to `query`.
          const [, result] = await base.$transaction([setConfigStatement, query(args)]);
          return result;
        },
      },
    },
  });
}

/**
 * For the existing `prisma.$transaction([opA, opB, ...])` (array form) call
 * sites that need their own atomicity (e.g. `UsersService.block`,
 * `ClientsService.deactivate`) — sets the current tenant/system context as
 * the transaction's first statement, then runs the rest of the array inside
 * the SAME transaction. Falls back to a plain, unscoped `$transaction` if
 * called with no tenant/system context active (should not normally happen
 * for these call sites — all of them run inside an authenticated request —
 * but mirrors the "no context = pass through unchanged" rule used
 * everywhere else in this file rather than silently forcing an empty/wrong
 * scope).
 */
export function runTenantTransaction<T extends readonly Prisma.PrismaPromise<unknown>[]>(
  prisma: { $transaction: PrismaClient['$transaction']; $executeRaw: PrismaClient['$executeRaw'] },
  ops: [...T],
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const store = getTenantStore();
  const transact = prisma.$transaction.bind(prisma) as (
    ops: Prisma.PrismaPromise<unknown>[],
  ) => Promise<unknown[]>;

  if (!store || (!store.companyId && !store.bypass)) {
    return transact(ops as unknown as Prisma.PrismaPromise<unknown>[]) as unknown as Promise<{
      [K in keyof T]: Awaited<T[K]>;
    }>;
  }
  const setConfigStatement = store.bypass
    ? prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`
    : prisma.$executeRaw`SELECT set_config('app.current_company_id', ${store.companyId}, true)`;

  return runInsideExplicitTenantTransaction(async () => {
    const [, ...results] = await transact([
      setConfigStatement,
      ...(ops as unknown as Prisma.PrismaPromise<unknown>[]),
    ]);
    return results as unknown as { [K in keyof T]: Awaited<T[K]> };
  });
}

/**
 * Same idea as `runTenantTransaction`, for the interactive
 * `prisma.$transaction(async (tx) => {...})` form (currently only
 * `AuthService.register`, which uses `runAsSystem` around this since it
 * creates a brand new company/user pre-authentication).
 */
export function runTenantInteractiveTransaction<T>(
  prisma: { $transaction: PrismaClient['$transaction'] },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const store = getTenantStore();
  if (!store || (!store.companyId && !store.bypass)) {
    return prisma.$transaction(fn);
  }
  return prisma.$transaction(async (tx) => {
    if (store.bypass) {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    } else {
      await tx.$executeRaw`SELECT set_config('app.current_company_id', ${store.companyId}, true)`;
    }
    return runInsideExplicitTenantTransaction(() => fn(tx));
  });
}
