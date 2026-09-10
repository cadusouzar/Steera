import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesService } from './roles.service';

describe('RolesService', () => {
  let service: RolesService;
  let prisma: { role: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      role: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
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
});
