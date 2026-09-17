-- Corrige um bug real encontrado em produção/dev na migration anterior
-- (20260917192555_backfill_granular_modules): "User" tem FORCE ROW LEVEL SECURITY
-- (ver 20260913140100_enable_row_level_security), e essa flag força a política até
-- pro dono da tabela/usuário de migration (quickflow_app) — sem
-- set_config('app.rls_bypass', 'on', true), os UPDATEs daquela migration bateram
-- contra "companyId" = NULL (nenhum contexto de tenant setado por `migrate deploy`),
-- que a policy sempre trata como UNKNOWN/false. Resultado: 0 linhas afetadas, em
-- SILÊNCIO (UPDATE sem match não é erro) — TODO login já existente no banco ficou
-- sem PONTO_REGISTRO/RH_CARGOS/RH_FUNCIONARIOS/PONTO_ADMINISTRACAO, incluindo
-- admins reais, apesar de `prisma migrate status` reportar a migration como
-- aplicada com sucesso. Achado ao investigar um admin real recebendo "Seu login
-- não tem acesso a este módulo" na tela de Usuários e Acessos.
--
-- Esta migration reaplica exatamente a mesma lógica (idempotente, seguro rodar de
-- novo em qualquer ambiente onde a original já tenha funcionado por acaso), agora
-- com o bypass de RLS setado primeiro — mesmo padrão já usado por
-- AuthService.runAsSystem/TenantMigrationManagerService pra este exato problema.

SELECT set_config('app.rls_bypass', 'on', true);

UPDATE "User"
SET modules = array_append(modules, 'PONTO_REGISTRO'::"AppModule")
WHERE NOT ('PONTO_REGISTRO'::"AppModule" = ANY(modules));

UPDATE "User"
SET modules = array_append(modules, 'RH_CARGOS'::"AppModule")
WHERE 'RH'::"AppModule" = ANY(modules) AND NOT ('RH_CARGOS'::"AppModule" = ANY(modules));

UPDATE "User"
SET modules = array_append(modules, 'RH_FUNCIONARIOS'::"AppModule")
WHERE 'RH'::"AppModule" = ANY(modules) AND NOT ('RH_FUNCIONARIOS'::"AppModule" = ANY(modules));

UPDATE "User"
SET modules = array_append(modules, 'PONTO_ADMINISTRACAO'::"AppModule")
WHERE 'RH'::"AppModule" = ANY(modules) AND NOT ('PONTO_ADMINISTRACAO'::"AppModule" = ANY(modules));
