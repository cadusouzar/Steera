import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkLocationsService } from './work-locations.service';

describe('WorkLocationsService', () => {
  let service: WorkLocationsService;
  let prisma: { workLocation: Record<string, jest.Mock> };
  let getCurrentCompanyId: jest.Mock;

  beforeEach(async () => {
    prisma = {
      workLocation: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    getCurrentCompanyId = jest.fn().mockResolvedValue('company-1');
    const module = await Test.createTestingModule({
      providers: [
        WorkLocationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId } },
      ],
    }).compile();
    service = module.get(WorkLocationsService);
  });

  it('creates a work location scoped to the current company, active by default', async () => {
    prisma.workLocation.create.mockResolvedValue({ id: 'location-1' });

    await service.create({ name: 'Matriz', latitude: -23.55052, longitude: -46.633308, radiusMeters: 100 });

    expect(prisma.workLocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', name: 'Matriz', active: true }),
    });
  });

  it('throws NotFoundException for a location belonging to another company', async () => {
    prisma.workLocation.findFirst.mockResolvedValue(null);
    await expect(service.findOne('location-other-company')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.workLocation.findFirst).toHaveBeenCalledWith({
      where: { id: 'location-other-company', companyId: 'company-1' },
    });
  });

  it('deletes a work location (hard delete)', async () => {
    prisma.workLocation.findFirst.mockResolvedValue({ id: 'location-1', companyId: 'company-1' });
    await service.remove('location-1');
    expect(prisma.workLocation.delete).toHaveBeenCalledWith({ where: { id: 'location-1' } });
  });

  describe('findAllActive', () => {
    it('returns only active locations for the current company', async () => {
      prisma.workLocation.findMany.mockResolvedValue([{ id: 'location-1', active: true, companyId: 'company-1' }]);

      const result = await service.findAllActive();

      expect(prisma.workLocation.findMany).toHaveBeenCalledWith({ where: { companyId: 'company-1', active: true } });
      expect(result).toHaveLength(1);
    });

    it('never asks Prisma for a different company than the current tenant', async () => {
      getCurrentCompanyId.mockResolvedValue('company-2');
      prisma.workLocation.findMany.mockResolvedValue([]);

      await service.findAllActive();

      expect(prisma.workLocation.findMany).toHaveBeenCalledWith({ where: { companyId: 'company-2', active: true } });
    });
  });
});
