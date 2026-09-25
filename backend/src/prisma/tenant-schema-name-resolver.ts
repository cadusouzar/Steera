import { assertValidSchemaName } from './tenant-schema.util';

/**
 * Descobre o schema físico de uma empresa lendo `Company.schemaName` (tabela central, sem RLS) —
 * uma consulta por empresa por processo, depois só `Map`. O cache NUNCA é invalidado porque o nome
 * é imutável após o cadastro. SEM fallback pra `tenant_<id>`: empresa não encontrada é erro —
 * rotear em silêncio pro schema errado seria pior que falhar.
 */
export class TenantSchemaNameResolver {
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly lookup: (companyId: string) => Promise<string | null>) {}

  resolve(companyId: string): Promise<string> {
    const cached = this.cache.get(companyId);
    if (cached) return Promise.resolve(cached);
    const pending = this.inFlight.get(companyId);
    if (pending) return pending;

    const promise = (async () => {
      const schemaName = await this.lookup(companyId);
      if (!schemaName) {
        throw new Error(`Empresa ${companyId} não encontrada ao resolver o schema físico`);
      }
      assertValidSchemaName(schemaName);
      this.cache.set(companyId, schemaName);
      return schemaName;
    })().finally(() => this.inFlight.delete(companyId));
    this.inFlight.set(companyId, promise);
    return promise;
  }
}

let registered: TenantSchemaNameResolver | undefined;

/** Chamado uma vez por `prisma.module.ts` (mesmo padrão de `registerTenantClientResolver`). */
export function registerTenantSchemaNameResolver(resolver: TenantSchemaNameResolver): void {
  registered = resolver;
}

export function resolveTenantSchemaName(companyId: string): Promise<string> {
  if (!registered) {
    return Promise.reject(new Error('TenantSchemaNameResolver não registrado (PrismaModule não inicializado?)'));
  }
  return registered.resolve(companyId);
}
