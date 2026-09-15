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
