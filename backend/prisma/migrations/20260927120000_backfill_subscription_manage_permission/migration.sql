-- Quem gerencia a assinatura (27/09/2026): nova permissão `assinatura.gerenciar` (comprar/trocar o
-- plano da empresa). Empresas novas já recebem a permissão no perfil "Administrador Geral" do
-- fundador (AuthService.register concede o catálogo inteiro); esta migration cobre as empresas que
-- JÁ existem: todo perfil que hoje concede `usuarios.gerenciar` (o equivalente a administrador)
-- passa a conceder também `assinatura.gerenciar` — assim nenhuma empresa fica sem ninguém capaz de
-- gerenciar a assinatura, e a trava de último detentor (protected-permissions.ts) já nasce valendo.
--
-- "Permission"/"ProfilePermission" são tabelas CENTRAIS (public). "ProfilePermission" tem FORCE ROW
-- LEVEL SECURITY (20260918194622_add_authorization_core), que vale até pro dono da tabela/usuário de
-- migration — sem o bypass abaixo, o INSERT ... SELECT leria zero linhas em silêncio (mesmo bug real
-- documentado em 20260917234400_fix_granular_modules_backfill_rls_bypass).

SELECT set_config('app.rls_bypass', 'on', true);

-- A linha do catálogo precisa existir ANTES dos grants (FK ON DELETE RESTRICT de
-- ProfilePermission.permissionCode -> Permission.code). O boot (AuthorizationService) faz o mesmo
-- upsert; aqui é só pra a migration não depender de o backend ter subido antes.
INSERT INTO "Permission" ("code", "resource", "action", "labelPt", "validScopes")
VALUES ('assinatura.gerenciar', 'assinatura', 'gerenciar', 'Gerenciar assinatura e plano', ARRAY[]::"Scope"[])
ON CONFLICT ("code") DO NOTHING;

-- Idempotente: um perfil que já concede a permissão é ignorado pelo índice único
-- (profileId, permissionCode). Sem escopo (validScopes vazio) → scope NULL.
INSERT INTO "ProfilePermission" ("id", "companyId", "profileId", "permissionCode", "scope")
SELECT gen_random_uuid()::text, pp."companyId", pp."profileId", 'assinatura.gerenciar', NULL
FROM "ProfilePermission" pp
WHERE pp."permissionCode" = 'usuarios.gerenciar'
ON CONFLICT ("profileId", "permissionCode") DO NOTHING;
