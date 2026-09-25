import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { buildTenantDatasourceUrl } from './tenant-datasource-url.util';
import { registerTenantSchemaNameResolver, TenantSchemaNameResolver } from './tenant-schema-name-resolver';
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
      provide: TenantSchemaNameResolver,
      // Client CRU (sem extensão): Company é central e sem RLS — a consulta nunca deve passar pelo
      // roteamento por tenant (evita qualquer chance de recursão resolver → extensão → resolver).
      useFactory: (raw: PrismaService) => {
        const resolver = new TenantSchemaNameResolver(async (companyId) => {
          const company = await raw.company.findUnique({ where: { id: companyId }, select: { schemaName: true } });
          return company?.schemaName ?? null;
        });
        registerTenantSchemaNameResolver(resolver);
        return resolver;
      },
      inject: [RAW_PRISMA_CLIENT],
    },
    {
      provide: TenantPrismaClientRegistry,
      useFactory: (schemaNames: TenantSchemaNameResolver) =>
        new TenantPrismaClientRegistry({
          maxSize: TENANT_CLIENT_CACHE_MAX_SIZE,
          evictionTimeoutMs: TENANT_CLIENT_EVICTION_TIMEOUT_MS,
          createClient: async (companyId) => {
            const schemaName = await schemaNames.resolve(companyId);
            const datasourceUrl = buildTenantDatasourceUrl(
              process.env.DATABASE_URL!,
              schemaName,
              TENANT_CLIENT_CONNECTION_LIMIT,
            );
            const raw = new PrismaClient({ datasourceUrl });
            // Sem segundo argumento: este client é de TENANT, não redireciona de novo.
            return raw.$extends(tenantRlsExtension(raw)) as unknown as PrismaClient;
          },
        }),
      inject: [TenantSchemaNameResolver],
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
  exports: [PrismaService, TenantPrismaClientRegistry, TenantSchemaNameResolver],
})
export class PrismaModule {}
