-- Backfill de dados pra preservar o acesso que já existia antes de "RH"/auto-atendimento de Ponto
-- virarem módulos granulares (ver AppModule no schema e a auditoria/design de 17/09/2026 no vault).
-- Sem isso, todo login já existente perderia o acesso ao próprio ponto (que hoje não exige módulo
-- nenhum) e todo login com "RH" perderia Cargos/Funcionários/Administração de Ponto no exato
-- momento do deploy. Só roda em SEGUIDA da migration anterior (que adiciona os valores de enum),
-- nunca na mesma transação — Postgres não permite usar um valor de enum recém-criado na mesma
-- transação em que foi adicionado.

-- Todo login já existente mantém a capacidade de bater o próprio ponto (hoje irrestrita).
UPDATE "User"
SET modules = array_append(modules, 'PONTO_REGISTRO'::"AppModule")
WHERE NOT ('PONTO_REGISTRO'::"AppModule" = ANY(modules));

-- Todo login que já tinha "RH" preserva o equivalente granular completo (Cargos, Funcionários e
-- Administração de Ponto), já que "RH" cobria as três coisas de uma vez antes desta mudança.
UPDATE "User"
SET modules = array_append(modules, 'RH_CARGOS'::"AppModule")
WHERE 'RH'::"AppModule" = ANY(modules) AND NOT ('RH_CARGOS'::"AppModule" = ANY(modules));

UPDATE "User"
SET modules = array_append(modules, 'RH_FUNCIONARIOS'::"AppModule")
WHERE 'RH'::"AppModule" = ANY(modules) AND NOT ('RH_FUNCIONARIOS'::"AppModule" = ANY(modules));

UPDATE "User"
SET modules = array_append(modules, 'PONTO_ADMINISTRACAO'::"AppModule")
WHERE 'RH'::"AppModule" = ANY(modules) AND NOT ('PONTO_ADMINISTRACAO'::"AppModule" = ANY(modules));
