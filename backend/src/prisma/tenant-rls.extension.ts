import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantStore, runInsideExplicitTenantTransaction } from './tenant-context';
import { assertValidSchemaName, tenantSchemaName } from './tenant-schema.util';
import { TENANT_TABLE_NAMES } from './tenant-table-names';

/**
 * Interface mínima que esta extensão e as duas transaction helpers abaixo precisam do registry —
 * a classe real (Task 2) tem exatamente estes três métodos públicos. Declarada localmente pra este
 * arquivo não depender de importar a classe concreta (evita um ciclo de import: o registry usa esta
 * extensão pra construir seus próprios clients de tenant).
 */
export interface TenantClientResolver {
  getClient(companyId: string): Promise<PrismaClient>;
  release(companyId: string): void;
  withClient<T>(companyId: string, fn: (client: PrismaClient) => Promise<T>): Promise<T>;
}

const TENANT_TABLE_SET: ReadonlySet<string> = new Set(TENANT_TABLE_NAMES);

function toModelProperty(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Ponto único de roteamento entre o client central e os clients de tenant.
 *
 * Dois modos, distinguidos pela presença do segundo argumento:
 * - `registry` presente: esta é a extensão do client CENTRAL. Toda operação numa tabela de tenant
 *   é redirecionada pro client daquela empresa (via `registry.withClient`); toda operação numa
 *   tabela central (User/Company/RefreshToken/TenantMigration) roda aqui mesmo, sem redirecionar.
 * - `registry` ausente: esta é a extensão de um client de TENANT específico, já resolvido e criado
 *   pelo próprio registry (ver Task 2's `createClient`, chamado sem passar `registry`). Toda
 *   operação que chega aqui já está no lugar certo — só precisa do `set_config` de RLS (defesa em
 *   profundidade dentro do próprio schema do tenant), nunca redireciona de novo (evitaria recursão
 *   infinita: se este client redirecionasse de novo, cairia nele mesmo, pra sempre).
 */
export function tenantRlsExtension(base: PrismaClient, registry?: TenantClientResolver) {
  return Prisma.defineExtension({
    name: 'tenant-rls',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const store = getTenantStore();

          if (!store || store.insideExplicitTx) return query(args);
          if (!store.companyId && !store.bypass) return query(args);

          if (store.bypass) {
            const results = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`,
              query(args),
            ]);
            return results[results.length - 1];
          }

          const isTenantModel = registry !== undefined && model !== undefined && TENANT_TABLE_SET.has(model);

          if (!isTenantModel) {
            // Defesa em profundidade (achado na revisão final): se ISTO é a extensão de um client de
            // TENANT específico (`registry` ausente) e o modelo NÃO é um modelo de tenant, algo
            // remontou esta chamada errado — um client de tenant só deveria ver operações em tabelas
            // de tenant (a extensão central já filtra isso antes de redirecionar). Rodar um modelo
            // central aqui compilaria a query contra o schema do TENANT, onde essa tabela não existe
            // (ou pior, existe uma tabela homônima e resolve silenciosamente errado) — melhor
            // quebrar alto e claro do que persistir/ler do lugar errado sem avisar ninguém.
            if (registry === undefined && model !== undefined && !TENANT_TABLE_SET.has(model)) {
              throw new Error(
                `tenantRlsExtension: modelo central "${model}" chamado num client de TENANT — isto é ` +
                  'um bug de roteamento, não uma operação válida. Modelos centrais só devem ser ' +
                  'acessados pelo client central (sem registry, isto é o client de um tenant específico).',
              );
            }
            // Modelo central — roda aqui mesmo, só com o set_config (RLS, defesa em profundidade).
            const results = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.current_company_id', ${store.companyId}, true)`,
              query(args),
            ]);
            return results[results.length - 1];
          }

          // Modelo de tenant no client CENTRAL: redireciona pro client resolvido da empresa.
          //
          // Achado empírico durante esta task (verificado contra Postgres real, não previsto no
          // design original): NÃO envolver esta chamada numa segunda `$transaction([...])` aqui —
          // uma primeira versão fazia `tenantClient.$transaction([setConfig, tenantClient[model][op]
          // (args)])`, mas `tenantClient[model][op](args)` já dispara a PRÓPRIA extensão do client
          // de tenant (modo registry-less, ver abaixo), cujo hook chama a SUA PRÓPRIA
          // `base.$transaction([...])` internamente — ou seja, um `$transaction` aninhado dentro de
          // outro, em conexões diferentes. Isso não lança erro nenhum (a operação retorna com
          // sucesso, inclusive satisfazendo a policy de RLS) mas o dado nunca fica persistido em
          // schema nenhum quando inspecionado por uma conexão separada logo em seguida — reproduzido
          // ao vivo com um `POST /clients` cujo Cliente criado não aparecia nem em
          // `tenant_<id>."Client"` nem em `public."Client"`. Delegar direto pro método do model no
          // client de tenant deixa a extensão DELE (o mesmo caminho testado sozinho por qualquer
          // client de tenant) ser a única dona da transação real — ela já aplica seu próprio
          // `set_config` como parte dessa mesma transação (branch `!isTenantModel` acima, que roda
          // pra TODO model quando `registry` está ausente).
          return registry!.withClient(store.companyId!, (tenantClient) => {
            const modelProperty = toModelProperty(model!);
            return (tenantClient as unknown as Record<string, any>)[modelProperty][operation](args);
          });
        },
      },
    },
  });
}

/** Emite as instruções de setup (SET LOCAL search_path + set_config, ou só o set_config de bypass)
 * que precedem o corpo de uma transação explícita — usado tanto pela forma array quanto pela
 * interativa abaixo. Sempre reemite o `, public`, mesmo quando o client já é o de um tenant
 * específico (cuja conexão já resolve `tenant_x` sozinha, sem o fallback pra `public`) — necessário
 * pra qualquer SQL bruto dentro da transação que precise alcançar uma tabela central (ex.: a
 * réplica de migrations, que tem `REFERENCES "Company"`). */
function buildSetupStatements(
  prisma: { $executeRaw: PrismaClient['$executeRaw']; $executeRawUnsafe: PrismaClient['$executeRawUnsafe'] },
  companyId: string | undefined,
  bypass: boolean | undefined,
): Prisma.PrismaPromise<unknown>[] {
  if (bypass) {
    return [prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`];
  }
  const schemaName = tenantSchemaName(companyId!);
  assertValidSchemaName(schemaName);
  return [
    prisma.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`),
    prisma.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`,
  ];
}

let registeredResolver: TenantClientResolver | undefined;

/** Chamado uma única vez por `prisma.module.ts` — dá às duas funções de transação abaixo acesso ao
 * mesmo registry usado pelo `$allOperations` da extensão central, sem precisar mudar a assinatura
 * pública delas (todos os 7 call sites existentes continuam chamando
 * `runTenantTransaction(this.prisma, [...])`/`runTenantInteractiveTransaction(this.prisma, fn)`
 * exatamente como hoje, só com 2 argumentos). Mesmo padrão de singleton por módulo já usado por
 * `tenant-context.ts` (AsyncLocalStorage), não uma invenção nova neste arquivo. */
export function registerTenantClientResolver(resolver: TenantClientResolver): void {
  registeredResolver = resolver;
}

export function getRegisteredTenantClientResolver(): TenantClientResolver | undefined {
  return registeredResolver;
}

export function runTenantTransaction<T extends readonly Prisma.PrismaPromise<unknown>[]>(
  prisma: {
    $transaction: PrismaClient['$transaction'];
    $executeRaw: PrismaClient['$executeRaw'];
    $executeRawUnsafe: PrismaClient['$executeRawUnsafe'];
  },
  ops: [...T],
  // Terceiro argumento só usado pelos testes unitários (Step 1) pra injetar um registry fake; os 7
  // call sites reais nunca passam isto — a função resolve o registry real via
  // `getRegisteredTenantClientResolver()` quando este argumento é omitido.
  registryOverride?: TenantClientResolver,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const store = getTenantStore();
  const registry = registryOverride ?? getRegisteredTenantClientResolver();

  if (!store || (!store.companyId && !store.bypass)) {
    const transact = prisma.$transaction.bind(prisma) as (
      ops: Prisma.PrismaPromise<unknown>[],
    ) => Promise<unknown[]>;
    return transact(ops as unknown as Prisma.PrismaPromise<unknown>[]) as unknown as Promise<{
      [K in keyof T]: Awaited<T[K]>;
    }>;
  }

  if (store.bypass || !registry) {
    const setupStatements = buildSetupStatements(prisma, store.companyId, store.bypass);
    const transact = prisma.$transaction.bind(prisma) as (
      ops: Prisma.PrismaPromise<unknown>[],
    ) => Promise<unknown[]>;
    return runInsideExplicitTenantTransaction(async () => {
      const results = await transact([...setupStatements, ...(ops as unknown as Prisma.PrismaPromise<unknown>[])]);
      return results.slice(setupStatements.length) as unknown as { [K in keyof T]: Awaited<T[K]> };
    });
  }

  // Nota: os dois call sites que tocavam tabela de tenant em modo NÃO-bypass (ClientsService/
  // EmployeesService.deactivate) já foram migrados pra `runTenantInteractiveTransaction`. Os
  // demais call sites de `runTenantTransaction` que restam (AuthService.changePassword,
  // UsersService.block) tocam só modelos CENTRAIS (User/RefreshToken) — nunca chegam a este
  // branch (`!isTenantModel` sempre roda no client base pra eles) e não têm motivo pra migrar.
  // Este branch fica aqui por completude/simetria da API, não por ter um chamador real hoje.
  return registry.withClient(store.companyId!, (tenantClient) => {
    const setupStatements = buildSetupStatements(tenantClient, store.companyId, false);
    return runInsideExplicitTenantTransaction(async () => {
      const results = await tenantClient.$transaction([...setupStatements, ...(ops as unknown as Prisma.PrismaPromise<unknown>[])]);
      return results.slice(setupStatements.length) as unknown as { [K in keyof T]: Awaited<T[K]> };
    });
  }) as unknown as Promise<{ [K in keyof T]: Awaited<T[K]> }>;
}

export function runTenantInteractiveTransaction<T>(
  prisma: { $transaction: PrismaClient['$transaction'] },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  registryOverride?: TenantClientResolver,
): Promise<T> {
  const store = getTenantStore();
  const registry = registryOverride ?? getRegisteredTenantClientResolver();

  if (!store || (!store.companyId && !store.bypass)) {
    return prisma.$transaction(fn);
  }

  if (store.bypass || !registry) {
    return prisma.$transaction(async (tx) => {
      const setupStatements = buildSetupStatements(tx, store.companyId, store.bypass);
      for (const stmt of setupStatements) await stmt;
      return runInsideExplicitTenantTransaction(() => fn(tx));
    });
  }

  return registry.withClient(store.companyId!, (tenantClient) =>
    (tenantClient as unknown as { $transaction: PrismaClient['$transaction'] }).$transaction(async (tx) => {
      const setupStatements = buildSetupStatements(tx, store.companyId, false);
      for (const stmt of setupStatements) await stmt;
      return runInsideExplicitTenantTransaction(() => fn(tx));
    }),
  );
}
