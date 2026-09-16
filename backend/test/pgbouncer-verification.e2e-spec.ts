import { PrismaClient } from '@prisma/client';

describe('PgBouncer — modo transação preserva SET LOCAL/set_config (e2e)', () => {
  it('SET LOCAL search_path definido numa transação não vaza pra fora dela, mesmo através do pooling por transação', async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/pgbouncer=true/.test(url)) {
      throw new Error('Este teste espera DATABASE_URL apontando pro PgBouncer (pgbouncer=true)');
    }
    const prisma = new PrismaClient();

    // Usa um valor claramente distinto do baseline da conexão (que, com `?schema=public` na
    // DATABASE_URL, já É literalmente "public" por padrão — testar contra 'public' não provaria
    // nada, a asserção "de fora" nunca distinguiria vazamento de comportamento normal). Um nome de
    // schema que nunca existiria de verdade deixa a checagem inequívoca: se aparecer "fora" da
    // transação, é vazamento; se não aparecer, o SET LOCAL foi corretamente descartado no fim da
    // transação, mesmo com o PgBouncer devolvendo a conexão física pro pool entre transações.
    const [, inside] = await prisma.$transaction([
      prisma.$executeRawUnsafe('SET LOCAL search_path TO pgbouncer_leak_probe_should_never_persist'),
      prisma.$queryRawUnsafe('SHOW search_path'),
    ]);
    expect((inside as any)[0].search_path).toContain('pgbouncer_leak_probe_should_never_persist');

    // Fora da transação, numa query nova (que pode pegar uma conexão física DIFERENTE emprestada
    // pelo PgBouncer) — o search_path da SESSÃO nunca deveria ter sido alterado, exatamente a
    // garantia que este projeto sempre dependeu.
    const outside = await prisma.$queryRawUnsafe('SHOW search_path');
    expect((outside as any)[0].search_path).not.toContain('pgbouncer_leak_probe_should_never_persist');

    await prisma.$disconnect();
  });

  it('duas transações concorrentes, cada uma com seu próprio SET LOCAL, nunca vazam uma pra outra', async () => {
    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();

    const [resultsA, resultsB] = await Promise.all([
      prismaA.$transaction([
        prismaA.$executeRawUnsafe(`SET LOCAL search_path TO "tenant_companyacuidlikeid1234567", public`),
        prismaA.$queryRawUnsafe('SHOW search_path'),
      ]),
      prismaB.$transaction([
        prismaB.$executeRawUnsafe(`SET LOCAL search_path TO "tenant_companybcuidlikeid1234567", public`),
        prismaB.$queryRawUnsafe('SHOW search_path'),
      ]),
    ]);

    expect((resultsA[1] as any)[0].search_path).toContain('tenant_companyacuidlikeid1234567');
    expect((resultsB[1] as any)[0].search_path).toContain('tenant_companybcuidlikeid1234567');

    await prismaA.$disconnect();
    await prismaB.$disconnect();
  });
});
