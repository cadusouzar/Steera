import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { buildTenantDatasourceUrl } from './tenant-datasource-url.util';
import { TenantPrismaClientRegistry } from './tenant-prisma-client-registry.service';
import { registerTenantClientResolver, tenantRlsExtension } from './tenant-rls.extension';

const RAW_PRISMA_CLIENT = Symbol('RAW_PRISMA_CLIENT');

const TENANT_CLIENT_CONNECTION_LIMIT = Number(process.env.TENANT_CLIENT_CONNECTION_LIMIT ?? 2);
const TENANT_CLIENT_CACHE_MAX_SIZE = Number(process.env.TENANT_CLIENT_CACHE_MAX_SIZE ?? 50);
const TENANT_CLIENT_EVICTION_TIMEOUT_MS = Number(process.env.TENANT_CLIENT_EVICTION_TIMEOUT_MS ?? 5000);

@Global()
@Module({
  providers: [
    { provide: RAW_PRISMA_CLIENT, useClass: PrismaService },
    {
      provide: TenantPrismaClientRegistry,
      useFactory: (raw: PrismaService) =>
        new TenantPrismaClientRegistry({
          maxSize: TENANT_CLIENT_CACHE_MAX_SIZE,
          evictionTimeoutMs: TENANT_CLIENT_EVICTION_TIMEOUT_MS,
          createClient: async (_companyId, schemaName) => {
            const datasourceUrl = buildTenantDatasourceUrl(
              process.env.DATABASE_URL!,
              schemaName,
              TENANT_CLIENT_CONNECTION_LIMIT,
            );
            const raw = new PrismaClient({ datasourceUrl });
            // Sem segundo argumento: este client é de TENANT, não redireciona de novo.
            return raw.$extends(tenantRlsExtension(raw)) as unknown as PrismaClient;
          },
          // Achado na revisão final: empresa cadastrada antes da Fase 1 do schema-per-tenant nunca
          // teve este schema criado — consultar `pg_namespace` (catálogo do sistema, sempre visível
          // não importa o search_path da conexão) via o client CENTRAL, nunca o de tenant que ainda
          // nem foi criado.
          checkSchemaExists: async (_companyId, schemaName) => {
            const rows = await raw.$queryRawUnsafe<{ exists: boolean }[]>(
              `SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists`,
              schemaName,
            );
            return rows[0].exists;
          },
        }),
      inject: [RAW_PRISMA_CLIENT],
    },
    {
      provide: PrismaService,
      useFactory: (raw: PrismaService, registry: TenantPrismaClientRegistry) => {
        registerTenantClientResolver(registry);
        return raw.$extends(tenantRlsExtension(raw, registry)) as unknown as PrismaService;
      },
      inject: [RAW_PRISMA_CLIENT, TenantPrismaClientRegistry],
    },
  ],
  exports: [PrismaService, TenantPrismaClientRegistry],
})
export class PrismaModule {}
