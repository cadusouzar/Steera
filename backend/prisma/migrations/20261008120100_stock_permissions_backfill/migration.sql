-- Estoque v1 (08/10/2026): oito permissões novas (estoque.*), todas com alcance EMPRESA e concedidas
-- pelo módulo OPERACOES (profile-signature.util.ts). Empresas novas já recebem tudo no perfil
-- "Administrador Geral" (register concede o catálogo inteiro). Para as empresas que JÁ existem:
-- perfis protegidos e perfis com usuarios.gerenciar (equivalentes a administrador) recebem as oito,
-- e perfis que só viam Operações (operacoes.ver) recebem estoque.ver.
--
-- Permission/Profile/ProfilePermission são CENTRAIS. Profile e ProfilePermission têm FORCE RLS, então
-- o bypass abaixo é obrigatório (sem ele os INSERT ... SELECT leriam zero linhas em silêncio).

SELECT set_config('app.rls_bypass', 'on', true);

INSERT INTO "Permission" ("code", "resource", "action", "labelPt", "validScopes") VALUES
  ('estoque.ver', 'estoque', 'ver', 'Ver Estoque', ARRAY['EMPRESA']::"Scope"[]),
  ('estoque.produtos.gerenciar', 'estoque', 'produtos.gerenciar', 'Cadastrar/editar Produtos', ARRAY['EMPRESA']::"Scope"[]),
  ('estoque.movimentar', 'estoque', 'movimentar', 'Registrar entradas e saídas de estoque', ARRAY['EMPRESA']::"Scope"[]),
  ('estoque.ajustar', 'estoque', 'ajustar', 'Ajustar estoque por contagem', ARRAY['EMPRESA']::"Scope"[]),
  ('estoque.estornar', 'estoque', 'estornar', 'Estornar movimentações de estoque', ARRAY['EMPRESA']::"Scope"[]),
  ('estoque.custos.ver', 'estoque', 'custos.ver', 'Ver custos e valor do estoque', ARRAY['EMPRESA']::"Scope"[]),
  ('estoque.exportar', 'estoque', 'exportar', 'Exportar relatórios de estoque', ARRAY['EMPRESA']::"Scope"[]),
  ('estoque.lixeira.gerenciar', 'estoque', 'lixeira.gerenciar', 'Excluir e restaurar Produtos', ARRAY['EMPRESA']::"Scope"[])
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "ProfilePermission" ("id", "companyId", "profileId", "permissionCode", "scope")
SELECT gen_random_uuid()::text, p."companyId", p."id", c.code, 'EMPRESA'::"Scope"
FROM "Profile" p
CROSS JOIN (VALUES ('estoque.ver'), ('estoque.produtos.gerenciar'), ('estoque.movimentar'), ('estoque.ajustar'),
                   ('estoque.estornar'), ('estoque.custos.ver'), ('estoque.exportar'), ('estoque.lixeira.gerenciar')) AS c(code)
WHERE p."isProtected" = true
   OR EXISTS (
     SELECT 1 FROM "ProfilePermission" pp
     WHERE pp."profileId" = p."id" AND pp."permissionCode" = 'usuarios.gerenciar'
   )
ON CONFLICT ("profileId", "permissionCode") DO NOTHING;

INSERT INTO "ProfilePermission" ("id", "companyId", "profileId", "permissionCode", "scope")
SELECT gen_random_uuid()::text, pp."companyId", pp."profileId", 'estoque.ver', 'EMPRESA'::"Scope"
FROM "ProfilePermission" pp
WHERE pp."permissionCode" = 'operacoes.ver'
ON CONFLICT ("profileId", "permissionCode") DO NOTHING;
