import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { CustomFieldValuesService } from '../custom-fields/custom-field-values.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  let service: RolesService;
  let prisma: {
    role: Record<string, jest.Mock>;
    company: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let customFieldValues: {
    resolveValuesForCreate: jest.Mock;
    setValues: jest.Mock;
    getValuesForRecords: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      role: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      // Padrão já usado por users.service.spec.ts: plano default PRO (sem teto), pra não afetar
      // os testes existentes que não têm nada a ver com plano/limite.
      company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ planTier: 'PRO' }) },
      // Mirrors Prisma's interactive form: $transaction(async (tx) => ...) invokes the callback
      // with a `tx` — here the same mocked `prisma` object, so existing assertions against
      // `prisma.role.create`/`prisma.role.update` keep working unchanged.
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    customFieldValues = {
      resolveValuesForCreate: jest.fn().mockResolvedValue({}),
      setValues: jest.fn(),
      getValuesForRecords: jest.fn().mockResolvedValue(new Map()),
    };
    const module = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
        { provide: CustomFieldValuesService, useValue: customFieldValues },
      ],
    }).compile();
    service = module.get(RolesService);
  });

  it('creates a role scoped to the current company', async () => {
    prisma.role.findFirst.mockResolvedValue(null);
    prisma.role.create.mockResolvedValue({ id: 'role-1', companyId: 'company-1', name: 'Designer', department: 'Produto' });

    await service.create({ name: 'Designer', department: 'Produto' });

    expect(prisma.role.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', name: 'Designer', colorHex: '#2563EB' }),
    });
  });

  it('passes a valid colorHex through to the database unchanged', async () => {
    // Validação real acontece no DTO via ValidationPipe (e2e); aqui garantimos
    // que o service aceita o valor já validado sem reformatá-lo.
    prisma.role.findFirst.mockResolvedValue(null);
    prisma.role.create.mockResolvedValue({ id: 'role-1' });
    await service.create({ name: 'Designer', department: 'Produto', colorHex: '#111111' });
    expect(prisma.role.create).toHaveBeenCalledWith({ data: expect.objectContaining({ colorHex: '#111111' }) });
  });

  it('rejects creating a duplicate active role name within the same company', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-existing' });
    await expect(service.create({ name: 'Designer', department: 'Produto' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException for a role belonging to another company', async () => {
    prisma.role.findFirst.mockResolvedValue(null);
    await expect(service.findOne('role-other-company')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.role.findFirst).toHaveBeenCalledWith({ where: { id: 'role-other-company', companyId: 'company-1' } });
  });

  it('deactivating a role does not delete it — only flips active to false', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', active: true, companyId: 'company-1' });
    prisma.role.update.mockResolvedValue({ id: 'role-1', active: false });
    await service.deactivate('role-1');
    expect(prisma.role.update).toHaveBeenCalledWith({ where: { id: 'role-1' }, data: { active: false } });
  });

  it('rejects deactivating a role that is already inactive', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', active: false, companyId: 'company-1' });
    await expect(service.deactivate('role-1')).rejects.toBeInstanceOf(ConflictException);
  });

  // Planos grátis e pagos (26/09/2026): teto de cargos ativos do plano Grátis.
  it('rejects creating a role when the free plan is at its active role limit', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
    prisma.role.findFirst.mockResolvedValue(null);
    prisma.role.count.mockResolvedValue(5);

    await expect(service.create({ name: 'Designer', department: 'Produto' })).rejects.toThrow(
      new ForbiddenException('Limite do plano Grátis: até 5 cargos ativos. Faça upgrade para cadastrar mais.'),
    );
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('allows creating a role on the free plan below the active role limit', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
    prisma.role.findFirst.mockResolvedValue(null);
    prisma.role.count.mockResolvedValue(4);
    prisma.role.create.mockResolvedValue({ id: 'role-1', companyId: 'company-1', name: 'Designer' });

    await service.create({ name: 'Designer', department: 'Produto' });

    expect(prisma.role.create).toHaveBeenCalled();
  });

  it('rejects reactivating a role when the free plan is at its active role limit', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', active: false, companyId: 'company-1', name: 'Designer' });
    prisma.role.count.mockResolvedValue(5);

    await expect(service.reactivate('role-1')).rejects.toThrow(
      new ForbiddenException('Limite do plano Grátis: até 5 cargos ativos. Faça upgrade para cadastrar mais.'),
    );
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('creates a role on a paid plan without checking the active role count', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'BASICO' });
    prisma.role.findFirst.mockResolvedValue(null);
    prisma.role.create.mockResolvedValue({ id: 'role-1', companyId: 'company-1', name: 'Designer' });

    await service.create({ name: 'Designer', department: 'Produto' });

    expect(prisma.role.count).not.toHaveBeenCalled();
  });
});
