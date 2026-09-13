-- Security-audit remediation (RLS backstop, step 2/2): database-level
-- Row-Level Security as a defense-in-depth backstop under the application's
-- existing companyId-filtering (which is correct today, confirmed by audit,
-- but has no DB-level backstop if a future bug ever reintroduces a missing
-- companyId filter — this exact class of bug happened once already, in the
-- Financeiro module).
--
-- FORCE ROW LEVEL SECURITY is not optional: without it, Postgres exempts the
-- table OWNER from every policy on it, and the app's own DB user
-- (quickflow_app, see backend/.env DATABASE_URL) is the owner of every table
-- here (it's also the migration user) — so omitting FORCE would make every
-- policy below a complete no-op for the app's actual connections. Verified
-- manually after applying (see the RLS report) by connecting as
-- quickflow_app and confirming the policy genuinely restricts rows.
--
-- current_setting(key, true) — the `true` second argument means "return
-- NULL instead of raising an error if the setting was never set", which
-- matters for any code path with no tenant context (migrations, health
-- checks, this project's own e2e-test setup/teardown code). With no
-- companyId set, `"companyId" = NULL` evaluates to UNKNOWN (never TRUE) for
-- every row, so USING correctly filters out everything and WITH CHECK
-- correctly rejects every write. NO TENANT CONTEXT = SEE/WRITE NOTHING. This
-- is the deliberate, safe default.
--
-- DEVIATION FROM A "PLAIN" companyId-only POLICY, flagged explicitly (see
-- the RLS report's "Architectural decisions and deviations" section for the
-- full reasoning): a small number of genuinely pre-authentication /
-- cross-tenant-by-necessity operations cannot know a companyId yet —
-- POST /auth/login must look up a User by email alone (email is globally
-- unique, not scoped to a company, and you can't know which company a user
-- belongs to before you've found the user), POST /auth/register creates the
-- very first User row of a brand new Company, and POST /auth/refresh looks
-- up a RefreshToken joined with its User before any tenant context exists.
-- A strict companyId-only policy on the User table would make login/
-- register/refresh fail unconditionally the moment FORCE RLS is turned on
-- for the User table. The OR clause below (`current_setting('app.rls_bypass',
-- true) = 'on'`) is a narrow, explicit escape hatch: it is set (via
-- set_config('app.rls_bypass', 'on', true), same LOCAL/transaction-scoped
-- pattern as the tenant id) ONLY by AuthService's three pre-auth call sites
-- (register/login/refresh — see auth.service.ts's `runAsSystem` usages) and
-- by this project's own e2e-test setup/teardown code, which talks to
-- PrismaService directly outside any HTTP request. It is applied uniformly
-- to all 11 tables (not just User) purely so the same single migration/
-- policy shape works everywhere — ordinary authenticated business-logic
-- code never sets this flag and has no way to reach it, so the backstop
-- this whole migration exists for is NOT weakened for the Client/Receivable/
-- etc. tables the original audit actually worried about.

ALTER TABLE "Client" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Client" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Client"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "Receivable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Receivable" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Receivable"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Subscription"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Role"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Employee"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "EmployeeWarning" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeWarning" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmployeeWarning"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "EmployeePayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeePayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmployeePayment"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "EmployeeRecurringPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeeRecurringPayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EmployeeRecurringPayment"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "VacationSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VacationSchedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "VacationSchedule"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "LeaveSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveSchedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveSchedule"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');
