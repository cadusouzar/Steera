import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { HolidaysService } from './holidays.service';

describe('HolidaysService', () => {
  let service: HolidaysService;
  let prisma: { holiday: Record<string, jest.Mock>; company: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      holiday: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
      company: { findUniqueOrThrow: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        HolidaysService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(HolidaysService);
  });

  describe('isHoliday', () => {
    it('returns true for a national holiday regardless of the company state', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'company-1', state: null });
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h1', scope: 'NATIONAL' });

      const date = new Date(Date.UTC(2026, 0, 1));
      await expect(service.isHoliday(date)).resolves.toBe(true);
      expect(prisma.holiday.findFirst).toHaveBeenCalledWith({
        where: { date, OR: [{ scope: 'NATIONAL' }, { scope: 'COMPANY', companyId: 'company-1' }] },
      });
    });

    it('includes the STATE clause only when the company has a state configured', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'company-1', state: 'SP' });
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h2', scope: 'STATE', state: 'SP' });

      const date = new Date(Date.UTC(2026, 6, 9));
      await expect(service.isHoliday(date)).resolves.toBe(true);
      expect(prisma.holiday.findFirst).toHaveBeenCalledWith({
        where: {
          date,
          OR: [{ scope: 'NATIONAL' }, { scope: 'STATE', state: 'SP' }, { scope: 'COMPANY', companyId: 'company-1' }],
        },
      });
    });

    it('returns false when no matching holiday is found', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'company-1', state: null });
      prisma.holiday.findFirst.mockResolvedValue(null);

      await expect(service.isHoliday(new Date(Date.UTC(2026, 5, 15)))).resolves.toBe(false);
    });
  });

  describe('createCustom', () => {
    it('creates a COMPANY-scoped holiday for the current company, parsing the date as UTC midnight', async () => {
      prisma.holiday.create.mockResolvedValue({ id: 'h3' });
      await service.createCustom({ date: '2026-12-24', name: 'Véspera de Natal (ponto facultativo)' });
      expect(prisma.holiday.create).toHaveBeenCalledWith({
        data: {
          scope: 'COMPANY',
          companyId: 'company-1',
          date: new Date(Date.UTC(2026, 11, 24)),
          name: 'Véspera de Natal (ponto facultativo)',
        },
      });
    });

    it('maps a duplicate custom holiday for the same date (P2002) to a clean 409 instead of an unhandled 500', async () => {
      prisma.holiday.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`scope`,`state`,`companyId`,`date`)', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['scope', 'state', 'companyId', 'date'] },
        }),
      );
      await expect(
        service.createCustom({ date: '2026-12-24', name: 'Véspera de Natal (ponto facultativo)' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('listForCompany', () => {
    it('lists national + state (when configured) + company holidays ordered by date', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'company-1', state: 'RJ' });
      prisma.holiday.findMany.mockResolvedValue([]);
      await service.listForCompany();
      expect(prisma.holiday.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ scope: 'NATIONAL' }, { scope: 'STATE', state: 'RJ' }, { scope: 'COMPANY', companyId: 'company-1' }],
        },
        orderBy: { date: 'asc' },
      });
    });
  });

  describe('removeCustom', () => {
    it('deletes a COMPANY-scoped holiday belonging to the current company', async () => {
      prisma.holiday.findFirst.mockResolvedValue({ id: 'h4', scope: 'COMPANY', companyId: 'company-1' });
      prisma.holiday.delete.mockResolvedValue({});
      await service.removeCustom('h4');
      expect(prisma.holiday.findFirst).toHaveBeenCalledWith({
        where: { id: 'h4', scope: 'COMPANY', companyId: 'company-1' },
      });
      expect(prisma.holiday.delete).toHaveBeenCalledWith({ where: { id: 'h4' } });
    });

    it('throws NotFoundException for a holiday belonging to another company or a non-COMPANY scope', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);
      await expect(service.removeCustom('h5')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.holiday.delete).not.toHaveBeenCalled();
    });
  });
});
