import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request (or per-explicit-transaction) tenant context, backing the
 * database-level Row-Level Security backstop (see the RLS migration and
 * `prisma.service.ts`'s `$extends` tenant-scoping extension).
 *
 * IMPORTANT: this ONLY carries the companyId across async boundaries inside
 * this Node process — it has nothing to do with the actual Postgres session
 * variable (`app.current_company_id`) that RLS policies read. The extension
 * in `prisma.service.ts` is what turns `getTenantCompanyId()` into a real,
 * transaction-scoped `set_config(..., true)` call. Never assume that merely
 * having a value here means the database has already been told about it.
 */
export interface TenantStore {
  companyId?: string;
  // Set for the handful of legitimate cross-tenant/pre-authentication
  // operations (see runAsSystem below) — deliberately narrow, audited set of
  // call sites only.
  bypass?: boolean;
  // Set while executing inside an explicit `prisma.$transaction(...)` call
  // that has ALREADY set the Postgres session var itself (see
  // `runTenantTransaction`/`runTenantInteractiveTransaction` in
  // `prisma.service.ts`) — tells the Prisma extension's per-operation hook
  // to pass queries straight through instead of wrapping each one in its own
  // separate mini-transaction, which would silently break the atomicity of
  // the outer transaction (verified empirically — see the RLS report).
  insideExplicitTx?: boolean;
}

const tenantStorage = new AsyncLocalStorage<TenantStore>();

/**
 * Wraps `fn` in a genuine `async` function before handing it to
 * `AsyncLocalStorage.run(...)`. This is NOT cosmetic: verified empirically
 * during development (see the RLS report) that when `fn` is a plain
 * (non-`async`) arrow function whose body calls straight into a Prisma
 * client method — e.g. `() => prisma.client.findMany(...)`, exactly the
 * style `TenantContextInterceptor` and every helper below originally used —
 * the AsyncLocalStorage context can silently fail to propagate into the
 * Prisma extension's `$allOperations` hook for some operations (`findMany`
 * reproduced this reliably; `findUnique` inside an `async` wrapper did not).
 * The practical effect was catastrophic and silent: `getTenantStore()`
 * inside the extension saw `undefined` for an affected query, which the
 * extension correctly treats as "no tenant context" and — since RLS's safe
 * default is "no context = see nothing" — the query would silently return
 * zero rows instead of the tenant's real data, with no error at all.
 * Forcing every entry point through an `async () => fn()` shim here fixes it
 * at the source, so no caller of `runWithTenant`/`runAsSystem`/
 * `runInsideExplicitTenantTransaction` needs to know about this or get it
 * right themselves.
 */
function runInStore<T>(store: TenantStore, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run(store, async () => fn());
}

/** Runs `fn` with `companyId` set as the active tenant for every Prisma
 * query executed anywhere in its (async) call graph. Used by the global
 * `TenantContextInterceptor` for every authenticated HTTP request. */
export function runWithTenant<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  const current = tenantStorage.getStore();
  return runInStore({ ...current, companyId, bypass: false }, fn);
}

/**
 * Escape hatch for the narrow set of operations that are legitimately
 * cross-tenant BY DESIGN and cannot have a `companyId` yet — resolving a
 * user's identity before authentication has happened (register/login/
 * refresh in AuthService) — plus this project's own e2e-test setup/teardown
 * code, which talks to the real Postgres database directly via
 * `PrismaService` outside of any HTTP request.
 *
 * This is intentionally NOT exported for general use — every call site that
 * uses it should be individually justified in a comment, the same way a raw
 * SQL escape hatch would be. It must never be reachable from a normal,
 * authenticated business-logic code path — that would silently defeat the
 * entire point of this RLS backstop.
 */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  const current = tenantStorage.getStore();
  return runInStore({ ...current, companyId: undefined, bypass: true }, fn);
}

/** Marks the current async context as already running inside an explicit,
 * tenant-scoped `prisma.$transaction(...)` — see `TenantStore.insideExplicitTx`. */
export function runInsideExplicitTenantTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const current = tenantStorage.getStore();
  return runInStore({ ...current, insideExplicitTx: true }, fn);
}

export function getTenantStore(): TenantStore | undefined {
  return tenantStorage.getStore();
}

export function getTenantCompanyId(): string | undefined {
  return tenantStorage.getStore()?.companyId;
}
