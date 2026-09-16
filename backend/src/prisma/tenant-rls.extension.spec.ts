jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    Prisma: {
      ...actual.Prisma,
      defineExtension: (definition: unknown) => definition,
    },
  };
});

import { runAsSystem, runWithTenant } from './tenant-context';
import { runTenantInteractiveTransaction, runTenantTransaction, tenantRlsExtension } from './tenant-rls.extension';

interface FakeBase {
  executedRawUnsafe: string[];
  $executeRaw: jest.Mock;
  $executeRawUnsafe: jest.Mock;
  $transaction: jest.Mock;
}

function makeBase(): FakeBase {
  const executedRawUnsafe: string[] = [];
  return {
    executedRawUnsafe,
    $executeRaw: jest.fn(() => 'set-config-stmt'),
    $executeRawUnsafe: jest.fn((sql: string) => {
      executedRawUnsafe.push(sql);
      return 'raw-stmt';
    }),
    $transaction: jest.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return arg.map((_s, i) => (i === arg.length - 1 ? 'query-result' : null));
      // Forma interativa: chama o callback com um `tx` que é o próprio `base` mockado.
      return (arg as (tx: unknown) => Promise<unknown>)(fakeBase);
    }),
  };
}
let fakeBase: FakeBase;

// Fake de registry consistente com a interface real: `withClient` é o único método que a extensão
// e as transaction helpers realmente chamam em produção quando a empresa TEM schema físico —
// `getClient`/`release` existem só porque a interface os declara. `hasPhysicalSchema` default
// `true` (a maioria dos testes exercita o caminho normal, com schema); o achado da revisão final
// (empresa legada sem schema) tem seus próprios testes dedicados abaixo, passando `false`
// explicitamente.
function makeFakeRegistry(tenantClient: unknown, hasPhysicalSchema = true) {
  const releaseSpy = jest.fn();
  const getClientSpy = jest.fn().mockResolvedValue(tenantClient);
  const withClientSpy = jest.fn(async (companyId: string, fn: (c: unknown) => Promise<unknown>) => {
    await getClientSpy(companyId);
    try {
      return await fn(tenantClient);
    } finally {
      releaseSpy(companyId);
    }
  });
  const hasPhysicalSchemaSpy = jest.fn().mockResolvedValue(hasPhysicalSchema);
  return { getClient: getClientSpy, release: releaseSpy, withClient: withClientSpy, hasPhysicalSchema: hasPhysicalSchemaSpy };
}

describe('tenantRlsExtension — modo bypass (inalterado)', () => {
  it('não redireciona nem define search_path em modo bypass', async () => {
    fakeBase = makeBase();
    const registry = makeFakeRegistry(undefined);
    const ext = tenantRlsExtension(fakeBase as any, registry as any);
    const allOperations = (ext as any).query.$allModels.$allOperations;

    const result = await runAsSystem(() =>
      allOperations({ model: 'User', operation: 'findFirst', args: {}, query: async () => 'query-result' }),
    );

    expect(result).toBe('query-result');
    expect(fakeBase.executedRawUnsafe).toEqual([]);
    expect(fakeBase.$transaction).toHaveBeenCalledWith(['set-config-stmt', expect.any(Promise)]);
    expect(registry.withClient).not.toHaveBeenCalled();
  });
});

describe('tenantRlsExtension — modelo central sob contexto real de tenant', () => {
  it('User resolve no client base (nunca redireciona), só com set_config', async () => {
    fakeBase = makeBase();
    const registry = makeFakeRegistry(undefined);
    const ext = tenantRlsExtension(fakeBase as any, registry as any);
    const allOperations = (ext as any).query.$allModels.$allOperations;

    const result = await runWithTenant('companyabc123456789012345', () =>
      allOperations({ model: 'User', operation: 'findFirst', args: {}, query: async () => 'query-result' }),
    );

    expect(result).toBe('query-result');
    expect(registry.withClient).not.toHaveBeenCalled();
    expect(fakeBase.executedRawUnsafe).toEqual([]); // sem SET LOCAL search_path — nunca precisou
    expect(fakeBase.$transaction).toHaveBeenCalledWith(['set-config-stmt', expect.any(Promise)]);
  });
});

describe('tenantRlsExtension — modelo de tenant sob contexto real: redireciona pro registry', () => {
  it('Client redireciona pro client resolvido do registry, nunca roda no client base', async () => {
    fakeBase = makeBase();
    // Nota (achado durante a implementação, corrigido em relação ao brief original): o redirecionamento
    // delega DIRETO pro método do model no client de tenant (`tenantClient.client.findMany(args)`),
    // sem envolver numa segunda `$transaction([...])` aqui — a extensão do PRÓPRIO client de tenant
    // (modo registry-less) já é quem abre a única transação real (set_config + query, atômicos, na
    // MESMA conexão). Envolver de novo aqui aninharia um `$transaction` dentro de outro, o que
    // reproduziu ao vivo, contra Postgres real, um bug sério: a operação retornava com sucesso mas o
    // dado nunca ficava persistido em schema nenhum. Por isso este fake não expõe `$transaction`
    // nenhum — só o método de model que a implementação corrigida realmente chama.
    const fakeTenantClient = {
      client: { findMany: jest.fn(async () => 'tenant-query-result') },
    };
    const registry = makeFakeRegistry(fakeTenantClient);
    const ext = tenantRlsExtension(fakeBase as any, registry as any);
    const allOperations = (ext as any).query.$allModels.$allOperations;

    const result = await runWithTenant('companyabc123456789012345', () =>
      allOperations({ model: 'Client', operation: 'findMany', args: { where: {} }, query: async () => 'never-called' }),
    );

    expect(result).toBe('tenant-query-result');
    expect(registry.withClient).toHaveBeenCalledWith('companyabc123456789012345', expect.any(Function));
    expect(registry.release).toHaveBeenCalledWith('companyabc123456789012345');
    expect(fakeBase.$transaction).not.toHaveBeenCalled(); // nunca rodou no client central
    expect(fakeTenantClient.client.findMany).toHaveBeenCalledWith({ where: {} });
  });

  it('propaga o erro da query pro chamador quando ela falha dentro do client do tenant, e ainda assim libera', async () => {
    fakeBase = makeBase();
    const fakeTenantClient = {
      client: { findMany: jest.fn().mockRejectedValue(new Error('query falhou')) },
    };
    const registry = makeFakeRegistry(fakeTenantClient);
    const ext = tenantRlsExtension(fakeBase as any, registry as any);
    const allOperations = (ext as any).query.$allModels.$allOperations;

    await expect(
      runWithTenant('companyabc123456789012345', () =>
        allOperations({ model: 'Client', operation: 'findMany', args: {}, query: async () => 'x' }),
      ),
    ).rejects.toThrow('query falhou');

    expect(registry.release).toHaveBeenCalledWith('companyabc123456789012345');
  });
});

describe('tenantRlsExtension — empresa legada, sem schema físico (achado na revisão final)', () => {
  it('modelo de tenant NUNCA redireciona quando a empresa não tem schema físico — roda no client central, só com set_config', async () => {
    fakeBase = makeBase();
    const registry = makeFakeRegistry(undefined, false); // hasPhysicalSchema: false
    const ext = tenantRlsExtension(fakeBase as any, registry as any);
    const allOperations = (ext as any).query.$allModels.$allOperations;

    const result = await runWithTenant('empresalegadasemschema1234', () =>
      allOperations({ model: 'Client', operation: 'findMany', args: {}, query: async () => 'query-result-legado' }),
    );

    expect(result).toBe('query-result'); // makeBase()'s $transaction mock returns this literal, see makeBase() above
    expect(registry.hasPhysicalSchema).toHaveBeenCalledWith('empresalegadasemschema1234');
    expect(registry.withClient).not.toHaveBeenCalled();
    expect(fakeBase.executedRawUnsafe).toEqual([]); // sem SET LOCAL search_path — não há schema pra apontar
    expect(fakeBase.$transaction).toHaveBeenCalledWith(['set-config-stmt', expect.any(Promise)]);
  });
});

describe('tenantRlsExtension — defesa em profundidade: modelo central num client de tenant (achado na revisão final)', () => {
  it('lança um erro explícito em vez de rodar silenciosamente contra o schema errado', async () => {
    fakeBase = makeBase();
    // `registry` ausente = este É um client de tenant específico (modo registry-less).
    const ext = tenantRlsExtension(fakeBase as any, undefined);
    const allOperations = (ext as any).query.$allModels.$allOperations;

    await expect(
      runWithTenant('companyabc123456789012345', () =>
        allOperations({ model: 'User', operation: 'findFirst', args: {}, query: async () => 'never-called' }),
      ),
    ).rejects.toThrow(/modelo central "User" chamado num client de TENANT/);
  });
});

describe('runTenantInteractiveTransaction — resolve pro client certo', () => {
  // Nota (achado durante a implementação, não estava assim no brief original): o mock original
  // deste teste passava uma string crua como `tx` pro callback, o que faz `buildSetupStatements`
  // quebrar ao tentar chamar `tx.$executeRaw` — e um `tx` real de verdade sempre tem esses métodos.
  // Mais importante: pular o `set_config('app.rls_bypass', ...)` neste caminho quebraria de verdade
  // o único caller real de bypass+interativa (`AuthService.register`), porque a tabela `User` tem
  // `FORCE ROW LEVEL SECURITY` com policy que exige exatamente esse `set_config` pra aceitar um
  // INSERT sem `companyId` ainda definido (ver
  // `prisma/migrations/20260913140100_enable_row_level_security/migration.sql`) — comportamento já
  // existente e inalterado por esta task. O teste abaixo mantém a intenção original (bypass usa o
  // `prisma` passado, nunca o registry) com um mock de `tx` que reflete a interface real.
  it('contexto central (bypass): usa o prisma passado, aplicando o set_config de bypass, sem tocar no registry', async () => {
    const bypassCalls: string[] = [];
    const prisma = {
      $transaction: jest.fn(async (fn: any) =>
        fn({
          $executeRaw: jest.fn(() => {
            bypassCalls.push('bypass-set-config');
            return undefined;
          }),
          $executeRawUnsafe: jest.fn(),
        }),
      ),
    };
    const registry = makeFakeRegistry(undefined);
    const result = await runAsSystem(() =>
      runTenantInteractiveTransaction(prisma as any, async () => 'central-tx', registry as any),
    );
    expect(result).toBe('central-tx');
    expect(bypassCalls).toEqual(['bypass-set-config']);
    expect(registry.withClient).not.toHaveBeenCalled();
  });

  it('contexto de tenant: resolve o client do registry, reemite SET LOCAL search_path + public, e libera ao final', async () => {
    const tenantExecuted: string[] = [];
    const fakeTenantClient = {
      $transaction: jest.fn(async (fn: any) =>
        fn({
          $executeRawUnsafe: jest.fn((sql: string) => { tenantExecuted.push(sql); }),
          $executeRaw: jest.fn(() => undefined),
        }),
      ),
    };
    const registry = makeFakeRegistry(fakeTenantClient);
    const prisma = { $transaction: jest.fn() }; // nunca deve ser chamado neste caminho

    await runWithTenant('companyabc123456789012345', () =>
      runTenantInteractiveTransaction(prisma as any, async () => 'ok', registry as any),
    );

    expect(registry.withClient).toHaveBeenCalledWith('companyabc123456789012345', expect.any(Function));
    expect(tenantExecuted[0]).toBe('SET LOCAL search_path TO "tenant_companyabc123456789012345", public');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(registry.release).toHaveBeenCalledWith('companyabc123456789012345');
  });

  it('empresa legada, sem schema físico: roda no prisma central passado, sem SET LOCAL search_path, sem tocar no registry.withClient', async () => {
    const executed: string[] = [];
    const prisma = {
      $transaction: jest.fn(async (fn: any) =>
        fn({
          $executeRawUnsafe: jest.fn((sql: string) => { executed.push(sql); }),
          $executeRaw: jest.fn(() => undefined),
        }),
      ),
    };
    const registry = makeFakeRegistry(undefined, false); // hasPhysicalSchema: false

    const result = await runWithTenant('empresalegadasemschema1234', () =>
      runTenantInteractiveTransaction(prisma as any, async () => 'ok-legado', registry as any),
    );

    expect(result).toBe('ok-legado');
    expect(registry.hasPhysicalSchema).toHaveBeenCalledWith('empresalegadasemschema1234');
    expect(registry.withClient).not.toHaveBeenCalled();
    expect(executed).toEqual([]); // nenhum SET LOCAL search_path — não há schema pra apontar
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('runTenantTransaction — forma array (mantida por completude, sem caller real após a Task 4)', () => {
  it('contexto central (bypass): roda no prisma passado, sem tocar no registry', async () => {
    const prisma = {
      $transaction: jest.fn(async (ops: unknown[]) => ops.map((_o, i) => (i === ops.length - 1 ? 'result' : null))),
      $executeRaw: jest.fn(() => 'set-config-bypass'),
      $executeRawUnsafe: jest.fn(),
    };
    const result = await runAsSystem(() => runTenantTransaction(prisma as any, ['op' as any]));
    expect(result).toEqual(['result']);
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('contexto de tenant: resolve o client do registry, reemite SET LOCAL search_path + public, e libera ao final', async () => {
    const fakeTenantClient = {
      $executeRaw: jest.fn(() => 'tenant-set-config'),
      $executeRawUnsafe: jest.fn((sql: string) => sql),
      $transaction: jest.fn(async (ops: unknown[]) => ops.map((_o, i) => (i === ops.length - 1 ? 'tenant-result' : null))),
    };
    const registry = makeFakeRegistry(fakeTenantClient);
    const prisma = { $transaction: jest.fn(), $executeRaw: jest.fn(), $executeRawUnsafe: jest.fn() };

    const result = await runWithTenant('companyabc123456789012345', () =>
      runTenantTransaction(prisma as any, ['op' as any], registry as any),
    );

    expect(result).toEqual(['tenant-result']);
    expect(registry.withClient).toHaveBeenCalledWith('companyabc123456789012345', expect.any(Function));
    expect(fakeTenantClient.$executeRawUnsafe).toHaveBeenCalledWith(
      'SET LOCAL search_path TO "tenant_companyabc123456789012345", public',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(registry.release).toHaveBeenCalledWith('companyabc123456789012345');
  });
});
