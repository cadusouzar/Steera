import { TenantPrismaClientRegistry } from './tenant-prisma-client-registry.service';

// Fake client mínimo, só com o que o registry precisa chamar (nunca um PrismaClient de verdade
// aqui — isso é testado de ponta a ponta contra Postgres real na Task 3/5).
function makeFakeClient() {
  return { $disconnect: jest.fn().mockResolvedValue(undefined) };
}

describe('TenantPrismaClientRegistry', () => {
  const companyId1 = 'company1cuidlikeid1234567';
  const companyId2 = 'company2cuidlikeid1234567';
  const companyId3 = 'company3cuidlikeid1234567';

  it('reaproveita o mesmo client em chamadas subsequentes pra mesma empresa (cache hit)', async () => {
    const createClient = jest.fn().mockImplementation(async () => makeFakeClient());
    const registry = new TenantPrismaClientRegistry({ maxSize: 10, evictionTimeoutMs: 1000, createClient });

    const clientA = await registry.getClient(companyId1);
    registry.release(companyId1);
    const clientB = await registry.getClient(companyId1);
    registry.release(companyId1);

    expect(clientA).toBe(clientB);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('deduplica criação concorrente — duas chamadas simultâneas pra uma empresa nova nunca criam dois clients', async () => {
    let resolveCreate!: (c: unknown) => void;
    const createClient = jest.fn().mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    const registry = new TenantPrismaClientRegistry({ maxSize: 10, evictionTimeoutMs: 1000, createClient });

    const p1 = registry.getClient(companyId1);
    const p2 = registry.getClient(companyId1);
    const fakeClient = makeFakeClient();
    resolveCreate(fakeClient);

    const [c1, c2] = await Promise.all([p1, p2]);
    registry.release(companyId1);
    registry.release(companyId1);

    expect(c1).toBe(c2);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('expulsa a entrada menos recentemente usada quando o cache está cheio', async () => {
    const createClient = jest.fn().mockImplementation(async () => makeFakeClient());
    const registry = new TenantPrismaClientRegistry({ maxSize: 2, evictionTimeoutMs: 1000, createClient });

    const clientA = await registry.getClient(companyId1);
    registry.release(companyId1);
    const clientB = await registry.getClient(companyId2);
    registry.release(companyId2);
    // Usa companyId1 de novo — vira a mais recentemente usada, companyId2 fica a mais antiga.
    await registry.getClient(companyId1);
    registry.release(companyId1);

    // companyId3 precisa de vaga — deve expulsar companyId2 (a menos recentemente usada), nunca companyId1.
    await registry.getClient(companyId3);
    registry.release(companyId3);

    // Espera a desconexão assíncrona da entrada expulsa terminar antes de checar.
    await new Promise((r) => setTimeout(r, 0));
    expect((clientB as unknown as ReturnType<typeof makeFakeClient>).$disconnect).toHaveBeenCalledTimes(1);
    expect((clientA as unknown as ReturnType<typeof makeFakeClient>).$disconnect).not.toHaveBeenCalled();

    // companyId1 ainda está no cache — pedir de novo não cria um client novo.
    createClient.mockClear();
    await registry.getClient(companyId1);
    registry.release(companyId1);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('nunca desconecta uma entrada com operação em andamento — adia até o release', async () => {
    const createClient = jest.fn().mockImplementation(async () => makeFakeClient());
    const registry = new TenantPrismaClientRegistry({ maxSize: 1, evictionTimeoutMs: 1000, createClient });

    const clientA = await registry.getClient(companyId1);
    // NÃO libera companyId1 ainda — simula uma operação lenta em andamento.

    // companyId2 precisa de vaga, mas a única entrada (companyId1) está em uso.
    const getClient2Promise = registry.getClient(companyId2);

    // Ainda não desconectou (operação de companyId1 continua em andamento).
    await new Promise((r) => setTimeout(r, 10));
    expect((clientA as unknown as ReturnType<typeof makeFakeClient>).$disconnect).not.toHaveBeenCalled();

    // Agora libera companyId1 — só ENTÃO a expulsão/desconexão pode acontecer.
    registry.release(companyId1);
    const clientB = await getClient2Promise;
    registry.release(companyId2);

    expect((clientA as unknown as ReturnType<typeof makeFakeClient>).$disconnect).toHaveBeenCalledTimes(1);
    expect(clientB).not.toBe(clientA);
  });

  it('withClient libera automaticamente mesmo se a função passada lançar', async () => {
    const createClient = jest.fn().mockImplementation(async () => makeFakeClient());
    const registry = new TenantPrismaClientRegistry({ maxSize: 10, evictionTimeoutMs: 1000, createClient });

    await expect(
      registry.withClient(companyId1, async () => {
        throw new Error('falha proposital');
      }),
    ).rejects.toThrow('falha proposital');

    // Se o release não tivesse acontecido, uma segunda empresa nunca conseguiria expulsar esta
    // entrada — confirma isso forçando um cache de tamanho 1.
    const registry2 = new TenantPrismaClientRegistry({ maxSize: 1, evictionTimeoutMs: 1000, createClient });
    await registry2.withClient(companyId1, async () => { throw new Error('x'); }).catch(() => {});
    const clientForCompany2 = await registry2.getClient(companyId2);
    registry2.release(companyId2);
    expect(clientForCompany2).toBeDefined();
  });

  it('lança um erro explícito se nenhuma vaga liberar dentro do timeout configurado', async () => {
    const createClient = jest.fn().mockImplementation(async () => makeFakeClient());
    const registry = new TenantPrismaClientRegistry({ maxSize: 1, evictionTimeoutMs: 50, createClient });

    await registry.getClient(companyId1); // nunca libera — ocupa a única vaga pra sempre neste teste

    await expect(registry.getClient(companyId2)).rejects.toThrow(/nenhuma vaga/i);
  });

  it('onApplicationShutdown desconecta todos os clients em cache', async () => {
    const createClient = jest.fn().mockImplementation(async () => makeFakeClient());
    const registry = new TenantPrismaClientRegistry({ maxSize: 10, evictionTimeoutMs: 1000, createClient });

    const clientA = await registry.getClient(companyId1);
    registry.release(companyId1);
    const clientB = await registry.getClient(companyId2);
    registry.release(companyId2);

    await registry.onApplicationShutdown();

    expect((clientA as unknown as ReturnType<typeof makeFakeClient>).$disconnect).toHaveBeenCalledTimes(1);
    expect((clientB as unknown as ReturnType<typeof makeFakeClient>).$disconnect).toHaveBeenCalledTimes(1);
  });

  it('nunca deixa o cache exceder maxSize quando várias empresas DIFERENTES e nunca vistas pedem client ao mesmo tempo', async () => {
    // Cada empresa resolve seu próprio createClient só quando o teste mandar — simula 3
    // requisições HTTP concorrentes reais, cada uma para uma empresa nova diferente, todas
    // ainda em andamento (nenhuma terminou de criar seu client) no momento em que a próxima
    // chega. `cache.size` sozinho ficaria em 0 durante toda essa rajada (nada foi inserido no
    // cache ainda — só depois que createClient resolve), então a checagem de capacidade precisa
    // contar `inFlightCreation.size` também, senão as 3 criações prosseguiriam mesmo com
    // maxSize=2, e o cache acabaria com 3 entradas — cada uma um pool de conexões real.
    const resolvers = new Map<string, (c: unknown) => void>();
    const createClient = jest.fn().mockImplementation(
      (companyId: string) => new Promise((resolve) => { resolvers.set(companyId, resolve); }),
    );
    const registry = new TenantPrismaClientRegistry({ maxSize: 2, evictionTimeoutMs: 1000, createClient });

    // Dispara as 3 chamadas de volta a volta, sem aguardar nenhuma — todas ficam em andamento.
    const p1 = registry.getClient(companyId1);
    const p2 = registry.getClient(companyId2);
    const p3 = registry.getClient(companyId3);

    // A 3ª empresa não pode ter começado a criar ainda: com maxSize=2 e as duas primeiras já em
    // andamento (inFlightCreation.size=2 no momento da checagem de companyId3), a checagem de
    // capacidade precisa bloquear a criação da 3ª até uma vaga liberar — createClient só pode
    // ter sido chamado pras duas primeiras até aqui.
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(resolvers.has(companyId3)).toBe(false);

    // Libera espaço: termina e libera a criação da primeira empresa.
    resolvers.get(companyId1)!(makeFakeClient());
    const clientA = await p1;
    registry.release(companyId1);

    // A expulsão (que ficou fazendo polling esperando uma entrada elegível) encontra companyId1
    // livre assim que o release acima acontece, e finalmente deixa companyId3 prosseguir — espera
    // isso terminar de acontecer (polling real, mesmo padrão dos outros testes de expulsão).
    while (!resolvers.has(companyId3)) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolvers.get(companyId3)!(makeFakeClient());
    const clientC = await p3;
    registry.release(companyId3);

    // Libera a segunda empresa também, pra fechar o cenário por completo.
    resolvers.get(companyId2)!(makeFakeClient());
    const clientB = await p2;
    registry.release(companyId2);

    expect(createClient).toHaveBeenCalledTimes(3);
    expect(clientC).toBeDefined();
    expect(clientB).toBeDefined();
    // companyId1 foi de fato expulso pra abrir espaço pra companyId3 — nunca companyId2, que
    // ainda estava em andamento (não elegível pra expulsão).
    expect((clientA as unknown as ReturnType<typeof makeFakeClient>).$disconnect).toHaveBeenCalledTimes(1);
  });
});
