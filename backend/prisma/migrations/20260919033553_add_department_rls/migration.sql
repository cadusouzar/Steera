-- RLS
-- `Department` nasceu como tabela de TENANT (está em TENANT_TABLE_NAMES desde a Task 1 de
-- authorization-architecture), mas a migration que a criou
-- (20260918194622_add_authorization_core) esqueceu de habilitar Row-Level Security — toda outra
-- tabela de tenant deste projeto tem ENABLE/FORCE ROW LEVEL SECURITY + a policy `tenant_isolation`.
-- Achado I1 da revisão final da branch: sem isto, o backstop de RLS documentado como invariante do
-- projeto inteiro estava silenciosamente ausente nesta única tabela.
ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Department"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');
