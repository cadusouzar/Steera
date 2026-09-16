import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenantMigrationManagerService } from './tenant-migration-manager.service';
// Import (não `require` dentro de cada teste, como o texto original desta task descrevia) da
// função já mockada abaixo — `@typescript-eslint/no-var-requires` (`--max-warnings 0` neste
// projeto) rejeita `require()` dentro de arquivo TypeScript; um `import` de nível de módulo
// resolve pro MESMO mock (o `jest.mock` abaixo intercepta a resolução do módulo real antes deste
// import rodar) sem precisar de `require`.
import { applyMigrations } from '../prisma/tenant-migration.util';

jest.mock('../prisma/migration-files.util', () => ({
  listMigrationNames: () => ['20260101000000_a', '20260102000000_b'],
}));
jest.mock('../prisma/tenant-migration.util', () => ({
  applyMigrations: jest.fn().mockResolvedValue(undefined),
}));

describe('TenantMigrationManagerService', () => {
  let service: TenantMigrationManagerService;
  let prisma: {
    company: { findMany: jest.Mock };
    tenantMigration: { findMany: jest.Mock };
    $executeRawUnsafe: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    // Necessário: `applyMigrations` (via `jest.mock` factory acima) é um jest.fn() de escopo de
    // MÓDULO, compartilhado entre os dois testes deste arquivo — sem limpar o histórico de
    // chamadas aqui, a asserção `.not.toHaveBeenCalled()` do segundo teste falha por causa da
    // chamada real do primeiro teste (confirmado rodando os dois testes isolados: cada um passa
    // sozinho, só a combinação falha). `clearAllMocks` (não `resetAllMocks`) preserva o
    // `.mockResolvedValue(undefined)` já configurado no `jest.mock` acima, só zera o histórico de
    // chamadas.
    jest.clearAllMocks();
    prisma = {
      company: { findMany: jest.fn() },
      tenantMigration: { findMany: jest.fn() },
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      // Tagged-template call (usado por runTenantInteractiveTransaction's set_config) — um
      // jest.fn() comum já recebe (strings, ...values) normalmente quando chamado como template.
      $executeRaw: jest.fn().mockResolvedValue(0),
      // `runTenantInteractiveTransaction` (Task 5, exercitado de verdade aqui, não mockado) chama
      // `prisma.$transaction(async (tx) => {...})` — passar `prisma` como o próprio `tx` é o
      // mesmo padrão de mock já usado no resto deste projeto pra esse helper.
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [TenantMigrationManagerService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TenantMigrationManagerService);
  });

  // IDs no formato cuid-like (20-30 chars minúsculos alfanuméricos) de propósito — o regex de
  // assertValidSchemaName (Task 1), agora genuinamente exercitado aqui via
  // runTenantInteractiveTransaction (não mockado), rejeitaria um id de teste do tipo "company-1".
  const companyId1 = 'company1cuidlikeid1234567';
  const companyId2 = 'company2cuidlikeid1234567';

  it('aplica só as migrations pendentes de cada empresa, pulando quem já está em dia', async () => {
    prisma.company.findMany.mockResolvedValue([{ id: companyId1 }, { id: companyId2 }]);
    prisma.tenantMigration.findMany.mockImplementation(({ where }: any) =>
      where.companyId === companyId1
        ? [{ migrationName: '20260101000000_a' }, { migrationName: '20260102000000_b' }]
        : [{ migrationName: '20260101000000_a' }],
    );

    await service.applyPendingMigrationsToAllTenants();

    expect(applyMigrations).toHaveBeenCalledTimes(1);
    expect(applyMigrations).toHaveBeenCalledWith(
      expect.anything(),
      companyId2,
      `tenant_${companyId2}`,
      expect.any(String),
      ['20260102000000_b'],
    );
  });

  it('não chama applyMigrations quando toda empresa já está em dia', async () => {
    prisma.company.findMany.mockResolvedValue([{ id: companyId1 }]);
    prisma.tenantMigration.findMany.mockResolvedValue([
      { migrationName: '20260101000000_a' },
      { migrationName: '20260102000000_b' },
    ]);

    await service.applyPendingMigrationsToAllTenants();

    expect(applyMigrations).not.toHaveBeenCalled();
  });
});
