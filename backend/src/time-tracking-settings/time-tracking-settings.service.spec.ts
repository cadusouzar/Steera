import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeTrackingSettingsService } from './time-tracking-settings.service';

describe('TimeTrackingSettingsService', () => {
  let service: TimeTrackingSettingsService;
  let prisma: { timeTrackingSettings: Record<string, jest.Mock> };
  let getCurrentCompanyId: jest.Mock;

  beforeEach(async () => {
    prisma = {
      timeTrackingSettings: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    getCurrentCompanyId = jest.fn().mockResolvedValue('company-1');
    const module = await Test.createTestingModule({
      providers: [
        TimeTrackingSettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId } },
      ],
    }).compile();
    service = module.get(TimeTrackingSettingsService);
  });

  describe('getOrCreateDefault', () => {
    it('returns the existing row when the company already has one', async () => {
      const existing = { id: 'settings-1', companyId: 'company-1', requirePhoto: true };
      prisma.timeTrackingSettings.findUnique.mockResolvedValue(existing);

      const result = await service.getOrCreateDefault('company-1');

      expect(result).toBe(existing);
      expect(prisma.timeTrackingSettings.create).not.toHaveBeenCalled();
    });

    // Empresa que nunca configurou nada não pode receber um erro — deve
    // devolver os defaults do schema.
    it('creates a row with schema defaults for a company that never configured settings', async () => {
      prisma.timeTrackingSettings.findUnique.mockResolvedValue(null);
      prisma.timeTrackingSettings.create.mockResolvedValue({ id: 'settings-1', companyId: 'company-1' });

      await service.getOrCreateDefault('company-1');

      expect(prisma.timeTrackingSettings.create).toHaveBeenCalledWith({ data: { companyId: 'company-1' } });
    });
  });

  describe('update', () => {
    it('creates the default row first, then applies the partial update, for a brand-new company', async () => {
      prisma.timeTrackingSettings.findUnique.mockResolvedValue(null);
      prisma.timeTrackingSettings.create.mockResolvedValue({ id: 'settings-1', companyId: 'company-1' });
      prisma.timeTrackingSettings.update.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', requirePhoto: false });

      await service.update({ requirePhoto: false });

      expect(prisma.timeTrackingSettings.create).toHaveBeenCalledWith({ data: { companyId: 'company-1' } });
      expect(prisma.timeTrackingSettings.update).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        data: { requirePhoto: false },
      });
    });

    it('does not recreate the row when settings already exist', async () => {
      prisma.timeTrackingSettings.findUnique.mockResolvedValue({ id: 'settings-1', companyId: 'company-1' });
      prisma.timeTrackingSettings.update.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', requirePhoto: false });

      await service.update({ requirePhoto: false });

      expect(prisma.timeTrackingSettings.create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrent', () => {
    it('resolves the company from the current request context', async () => {
      prisma.timeTrackingSettings.findUnique.mockResolvedValue({ id: 'settings-1', companyId: 'company-1' });
      await service.getCurrent();
      expect(getCurrentCompanyId).toHaveBeenCalled();
    });
  });
});
