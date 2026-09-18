-- `CustomFieldType` é um enum de tabela de TENANT (usado só por `CustomFieldDefinition`, que vive
-- em `tenant_<companyId>`, nunca em `public`) — diferente de `AppModule`/`UserStatus`
-- (`CENTRAL_ONLY_ENUM_NAMES` em generate-tenant-migrations.ts), esta migration PRECISA ser
-- replayada em todo schema de tenant (novos e já existentes), então não entra naquela lista.

ALTER TYPE "CustomFieldType" ADD VALUE 'CPF';
ALTER TYPE "CustomFieldType" ADD VALUE 'CNPJ';
