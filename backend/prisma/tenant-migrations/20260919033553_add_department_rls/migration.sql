ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Department"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');
