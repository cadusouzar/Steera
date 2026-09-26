-- Dados da etapa anterior (20260926120000_access_and_sessions). "User" tem FORCE ROW LEVEL
-- SECURITY (ver 20260913140100_enable_row_level_security) — isso força a política até pro dono
-- da tabela/usuário de migration (quickflow_app), e sem nenhum contexto de tenant setado por
-- `migrate deploy` os UPDATEs abaixo bateriam contra "companyId" = NULL (sempre UNKNOWN/false),
-- afetando 0 linhas em silêncio (mesmo bug real já documentado em
-- 20260917234400_fix_granular_modules_backfill_rls_bypass). Mesmo bypass usado ali e por
-- AuthService.runAsSystem/TenantMigrationManagerService pra este exato problema.

SELECT set_config('app.rls_bypass', 'on', true);

-- Bloqueio permanente (LOCKED) virou temporário: libera quem estava travado.
UPDATE "User" SET "status" = 'ACTIVE', "failedLoginAttempts" = 0 WHERE "status" = 'LOCKED';
-- Logins anteriores a esta etapa já estão em uso: tratá-los como confirmados.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "emailVerifiedAt" IS NULL;
