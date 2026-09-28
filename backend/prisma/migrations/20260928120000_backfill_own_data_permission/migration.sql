-- "Pode alterar os próprios dados?" (28/09/2026): nova permissão `funcionarios.proprios.gerenciar`,
-- exigida além da permissão/alcance normais em toda escrita cuja ficha-alvo é a do próprio login
-- (EmployeeScopeService.assertCanWriteOwn). Empresas novas já recebem a permissão no perfil
-- "Administrador Geral" do fundador (AuthService.register concede o catálogo inteiro); esta migration
-- cobre as empresas que JÁ existem: todo perfil protegido ("Administrador Geral", isProtected) e todo
-- perfil que concede `usuarios.gerenciar` (o equivalente a administrador) passam a concedê-la — assim
-- quem hoje administra continua podendo alterar a própria ficha, e os demais perfis ficam em "Não".
--
-- "Permission"/"Profile"/"ProfilePermission" são tabelas CENTRAIS (public). "Profile" e
-- "ProfilePermission" têm FORCE ROW LEVEL SECURITY (20260918194622_add_authorization_core), que vale
-- até pro dono da tabela/usuário de migration — sem o bypass abaixo, os INSERT ... SELECT leriam zero
-- linhas em silêncio (mesmo bug real documentado em 20260917234400_fix_granular_modules_backfill_rls_bypass).

SELECT set_config('app.rls_bypass', 'on', true);

-- A linha do catálogo precisa existir ANTES dos grants (FK ON DELETE RESTRICT de
-- ProfilePermission.permissionCode -> Permission.code). O boot (AuthorizationService) faz o mesmo
-- upsert; aqui é só pra a migration não depender de o backend ter subido antes.
INSERT INTO "Permission" ("code", "resource", "action", "labelPt", "validScopes")
VALUES ('funcionarios.proprios.gerenciar', 'funcionarios', 'proprios.gerenciar', 'Alterar os próprios dados', ARRAY[]::"Scope"[])
ON CONFLICT ("code") DO NOTHING;

-- Idempotente: um perfil que já concede a permissão é ignorado pelo índice único
-- (profileId, permissionCode). Sem escopo (validScopes vazio) → scope NULL.
INSERT INTO "ProfilePermission" ("id", "companyId", "profileId", "permissionCode", "scope")
SELECT gen_random_uuid()::text, p."companyId", p."id", 'funcionarios.proprios.gerenciar', NULL
FROM "Profile" p
WHERE p."isProtected" = true
   OR EXISTS (
     SELECT 1 FROM "ProfilePermission" pp
     WHERE pp."profileId" = p."id" AND pp."permissionCode" = 'usuarios.gerenciar'
   )
ON CONFLICT ("profileId", "permissionCode") DO NOTHING;
