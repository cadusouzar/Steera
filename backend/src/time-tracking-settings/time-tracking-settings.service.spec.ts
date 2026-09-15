import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { TimeTrackingSettingsService } from './time-tracking-settings.service';

describe('TimeTrackingSettingsService', () => {
  let service: TimeTrackingSettingsService;
  let prisma: {
    timeTrackingSettings: Record<string, jest.Mock>;
    employee: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let getCurrentCompanyId: jest.Mock;

  const admin: AuthenticatedUser = {
    userId: 'admin-1',
    companyId: 'company-1',
    role: 'ADMIN',
    modules: [],
    mustChangePassword: false,
    hasFullPontoAccess: true,
  };

  beforeEach(async () => {
    prisma = {
      timeTrackingSettings: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      employee: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    getCurrentCompanyId = jest.fn().mockResolvedValue('company-1');
    const module = await Test.createTestingModule({
      providers: [
        TimeTrackingSettingsService,
        TimeManagementAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId } },
      ],
    }).compile();
    service = module.get(TimeTrackingSettingsService);
  });

  describe('getOrCreateDefault', () => {
    it('returns the existing row when the company already has one', async () => {
      const existing = { id: 'settings-1', companyId: 'company-1', managerId: null, requirePhoto: true };
      prisma.timeTrackingSettings.findFirst.mockResolvedValue(existing);

      const result = await service.getOrCreateDefault('company-1');

      expect(result).toBe(existing);
      expect(prisma.timeTrackingSettings.create).not.toHaveBeenCalled();
      expect(prisma.timeTrackingSettings.findFirst).toHaveBeenCalledWith({ where: { companyId: 'company-1', managerId: null } });
    });

    // Empresa que nunca configurou nada não pode receber um erro — deve
    // devolver os defaults do schema.
    it('creates a row with schema defaults for a company that never configured settings', async () => {
      prisma.timeTrackingSettings.findFirst.mockResolvedValue(null);
      prisma.timeTrackingSettings.create.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', managerId: null });

      await service.getOrCreateDefault('company-1');

      expect(prisma.timeTrackingSettings.create).toHaveBeenCalledWith({ data: { companyId: 'company-1', managerId: undefined } });
    });
  });

  describe('update', () => {
    it('creates the default row first, then applies the partial update, for a brand-new company', async () => {
      prisma.timeTrackingSettings.findFirst.mockResolvedValue(null);
      prisma.timeTrackingSettings.create.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', managerId: null });
      prisma.timeTrackingSettings.update.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', requirePhoto: false });

      await service.update({ requirePhoto: false }, admin);

      expect(prisma.timeTrackingSettings.create).toHaveBeenCalledWith({ data: { companyId: 'company-1', managerId: undefined } });
      expect(prisma.timeTrackingSettings.update).toHaveBeenCalledWith({
        where: { id: 'settings-1' },
        data: { requirePhoto: false },
      });
    });

    it('does not recreate the row when settings already exist', async () => {
      prisma.timeTrackingSettings.findFirst.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', managerId: null });
      prisma.timeTrackingSettings.update.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', requirePhoto: false });

      await service.update({ requirePhoto: false }, admin);

      expect(prisma.timeTrackingSettings.create).not.toHaveBeenCalled();
    });
  });

  describe('getCurrent', () => {
    it('resolves the company from the current request context', async () => {
      prisma.timeTrackingSettings.findFirst.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', managerId: null });
      await service.getCurrent();
      expect(getCurrentCompanyId).toHaveBeenCalled();
    });
  });

  describe('update — authorization by tier', () => {
    it('rejects editing the company default without hasFullPontoAccess', async () => {
      const limitedAdmin = { userId: 'u1', companyId: 'company-1', role: 'ADMIN' as const, modules: [], mustChangePassword: false, hasFullPontoAccess: false };

      await expect(service.update({ requirePhoto: false }, limitedAdmin)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows a manager to edit their OWN team override', async () => {
      const managerLogin = { userId: 'u2', companyId: 'company-1', role: 'EMPLOYEE' as const, modules: [], mustChangePassword: false, hasFullPontoAccess: true };
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.findFirst.mockResolvedValue({ id: 'settings-2', companyId: 'company-1', managerId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.update.mockResolvedValue({ id: 'settings-2', requirePhoto: false });

      await service.update({ requirePhoto: false, managerId: 'employee-mgr-1' }, managerLogin);

      expect(prisma.timeTrackingSettings.update).toHaveBeenCalledWith({ where: { id: 'settings-2' }, data: { requirePhoto: false } });
    });
  });

  // Achado C1 da revisão final (15/09/2026): abrir a aba de Configuração como superior restrito
  // (um GET puro, sem nenhum clique em Salvar) criava silenciosamente a sobrescrita do time com os
  // defaults do SCHEMA, divergindo do que a empresa tinha configurado. Leitura agora nunca
  // escreve.
  describe('getScoped', () => {
    const companyDefault = {
      id: 'settings-1', companyId: 'company-1', managerId: null,
      requirePhoto: false, requireLocation: false, allowLocationException: true,
      allowExtraPeriods: false, maxAttachmentSizeBytes: 1234,
    };

    it('returns the COMPANY default (never creating a row) when the manager has no override yet', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', employeeId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.findFirst
        .mockResolvedValueOnce(null) // manager override lookup
        .mockResolvedValueOnce(companyDefault); // getOrCreateDefault's own lookup

      const result = await service.getScoped('employee-mgr-1', admin);

      expect(prisma.timeTrackingSettings.create).not.toHaveBeenCalled();
      expect(result).toEqual({ ...companyDefault, inherited: true });
    });

    it("returns the manager's OWN override, flagged as not inherited, when one exists", async () => {
      const override = { id: 'settings-2', companyId: 'company-1', managerId: 'employee-mgr-1', requirePhoto: true };
      prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', employeeId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.findFirst.mockResolvedValueOnce(override);

      const result = await service.getScoped('employee-mgr-1', admin);

      expect(result).toEqual({ ...override, inherited: false });
      expect(prisma.timeTrackingSettings.create).not.toHaveBeenCalled();
    });

    it('reading the company default itself is never flagged as inherited', async () => {
      prisma.timeTrackingSettings.findFirst.mockResolvedValue(companyDefault);
      const result = await service.getScoped(undefined, admin);
      expect(result).toEqual({ ...companyDefault, inherited: false });
    });

    it("rejects reading ANOTHER manager's override without hasFullPontoAccess", async () => {
      const limitedAdmin = { ...admin, hasFullPontoAccess: false };
      prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', employeeId: 'employee-mgr-1' });

      await expect(service.getScoped('employee-mgr-2', limitedAdmin)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.timeTrackingSettings.create).not.toHaveBeenCalled();
    });
  });

  describe('update — first-ever team override', () => {
    const companyDefault = {
      id: 'settings-1', companyId: 'company-1', managerId: null,
      requirePhoto: false, requireLocation: false, allowLocationException: true,
      allowExtraPeriods: false, maxAttachmentSizeBytes: 1234,
    };

    // Achado C1 (parte 2): a linha nova tem que nascer como CÓPIA do padrão atual da empresa —
    // antes, os 4 campos não tocados voltavam silenciosamente pros defaults do schema.
    it("seeds the new override row from the company's CURRENT values, not from schema defaults", async () => {
      const managerLogin = { userId: 'u2', companyId: 'company-1', role: 'ADMIN' as const, modules: [], mustChangePassword: false, hasFullPontoAccess: true };
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.findFirst
        .mockResolvedValueOnce(companyDefault) // getOrCreateDefault (fonte dos valores-base)
        .mockResolvedValueOnce(null); // sobrescrita do superior: ainda não existe
      prisma.timeTrackingSettings.create.mockResolvedValue({ id: 'settings-2', companyId: 'company-1', managerId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.update.mockResolvedValue({ id: 'settings-2', requirePhoto: true });

      await service.update({ requirePhoto: true, managerId: 'employee-mgr-1' }, managerLogin);

      expect(prisma.timeTrackingSettings.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          managerId: 'employee-mgr-1',
          requirePhoto: false,
          requireLocation: false,
          allowLocationException: true,
          allowExtraPeriods: false,
          maxAttachmentSizeBytes: 1234,
        },
      });
      // O campo de fato alterado é aplicado por cima da cópia.
      expect(prisma.timeTrackingSettings.update).toHaveBeenCalledWith({
        where: { id: 'settings-2' },
        data: { requirePhoto: true },
      });
    });

    // Duas primeiras escritas simultâneas pra mesma chave: o índice único é PARCIAL (SQL bruto),
    // então não há upsert possível — a perdedora captura o P2002 e relê em vez de vazar um 500.
    it('recovers from a concurrent first write (P2002) by re-reading the row the other request created', async () => {
      const raced = { id: 'settings-2', companyId: 'company-1', managerId: null, requirePhoto: true };
      prisma.timeTrackingSettings.findFirst
        .mockResolvedValueOnce(null) // primeira leitura: nada existe ainda
        .mockResolvedValueOnce(raced); // releitura após o P2002
      prisma.timeTrackingSettings.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
      );

      const result = await service.getOrCreateDefault('company-1');

      expect(result).toBe(raced);
    });
  });

  describe('getEffectiveSettingsForEmployee', () => {
    it("uses the employee's direct manager's override when one exists", async () => {
      prisma.employee.findUnique.mockResolvedValue({ managerId: 'employee-mgr-1' });
      const override = { id: 'settings-2', companyId: 'company-1', managerId: 'employee-mgr-1', requirePhoto: false };
      prisma.timeTrackingSettings.findFirst.mockResolvedValueOnce(override);

      const result = await service.getEffectiveSettingsForEmployee('employee-1', 'company-1');

      expect(result).toBe(override);
    });

    it('falls back to the company default when the manager has no override', async () => {
      prisma.employee.findUnique.mockResolvedValue({ managerId: 'employee-mgr-1' });
      prisma.timeTrackingSettings.findFirst
        .mockResolvedValueOnce(null) // manager override lookup
        .mockResolvedValueOnce({ id: 'settings-1', companyId: 'company-1', managerId: null }); // getOrCreateDefault's own lookup

      const result = await service.getEffectiveSettingsForEmployee('employee-1', 'company-1');

      expect(result).toEqual({ id: 'settings-1', companyId: 'company-1', managerId: null });
    });

    it('falls back to the company default when the employee has no manager at all', async () => {
      prisma.employee.findUnique.mockResolvedValue({ managerId: null });
      prisma.timeTrackingSettings.findFirst.mockResolvedValue({ id: 'settings-1', companyId: 'company-1', managerId: null });

      const result = await service.getEffectiveSettingsForEmployee('employee-1', 'company-1');

      expect(result).toEqual({ id: 'settings-1', companyId: 'company-1', managerId: null });
    });
  });
});
