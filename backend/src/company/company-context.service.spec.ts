import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyContextService } from './company-context.service';

describe('CompanyContextService', () => {
  let service: CompanyContextService;
  let prisma: { company: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = { company: { findFirst: jest.fn(), create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [CompanyContextService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CompanyContextService);
  });

  it('returns the existing company id when one already exists', async () => {
    prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    const id = await service.getCurrentCompanyId();
    expect(id).toBe('company-1');
    expect(prisma.company.create).not.toHaveBeenCalled();
  });

  it('creates a default company when none exists yet', async () => {
    prisma.company.findFirst.mockResolvedValue(null);
    prisma.company.create.mockResolvedValue({ id: 'company-2' });
    const id = await service.getCurrentCompanyId();
    expect(id).toBe('company-2');
    expect(prisma.company.create).toHaveBeenCalledWith({ data: { name: 'Empresa Padrão' } });
  });

  it('caches the resolved company id across calls, avoiding repeated lookups', async () => {
    prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    await service.getCurrentCompanyId();
    await service.getCurrentCompanyId();
    expect(prisma.company.findFirst).toHaveBeenCalledTimes(1);
  });
});
