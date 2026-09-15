import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { TimeAdjustmentsService } from './time-adjustments.service';

jest.mock('../prisma/tenant-rls.extension', () => ({
  runTenantInteractiveTransaction: jest.fn((_prisma: unknown, fn: (tx: unknown) => unknown) => fn('tx-marker')),
}));

const employeeUser: AuthenticatedUser = {
  userId: 'user-1', companyId: 'company-1', role: 'EMPLOYEE', modules: ['RH'], mustChangePassword: false, hasFullPontoAccess: true,
};
const managerUser: AuthenticatedUser = {
  userId: 'user-manager', companyId: 'company-1', role: 'EMPLOYEE', modules: ['RH'], mustChangePassword: false, hasFullPontoAccess: true,
};
const adminUser: AuthenticatedUser = {
  userId: 'user-admin', companyId: 'company-1', role: 'ADMIN', modules: ['RH'], mustChangePassword: false, hasFullPontoAccess: true,
};

const employee = { id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' };

describe('TimeAdjustmentsService', () => {
  let service: TimeAdjustmentsService;
  let prisma: {
    timeAdjustmentRequest: Record<string, jest.Mock>;
    timeEvent: Record<string, jest.Mock>;
    timeCorrection: Record<string, jest.Mock>;
  };
  let files: { upload: jest.Mock };
  let timeManagementAuth: {
    resolveOwnEmployee: jest.Mock;
    assertCanManage: jest.Mock;
    getManageableEmployeeIds: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      timeAdjustmentRequest: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
      timeEvent: { findFirst: jest.fn(), findUnique: jest.fn() },
      timeCorrection: { create: jest.fn() },
    };
    files = { upload: jest.fn() };
    timeManagementAuth = {
      resolveOwnEmployee: jest.fn().mockResolvedValue(employee),
      assertCanManage: jest.fn().mockResolvedValue(undefined),
      getManageableEmployeeIds: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        TimeAdjustmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FilesService, useValue: files },
        { provide: TimeManagementAuthService, useValue: timeManagementAuth },
      ],
    }).compile();
    service = module.get(TimeAdjustmentsService);
  });

  describe('create', () => {
    const baseDto = { targetDate: '2026-09-14', type: 'CORRECT_TIME', relatedEventId: 'event-1', reason: 'esqueci de bater' } as any;

    it('creates a request for the caller\'s own employee, never trusting an employeeId from the DTO', async () => {
      prisma.timeEvent.findFirst.mockResolvedValue({ id: 'event-1', employeeId: 'employee-1' });
      prisma.timeAdjustmentRequest.create.mockResolvedValue({ id: 'req-1' });

      await service.create(employeeUser, baseDto);

      expect(timeManagementAuth.resolveOwnEmployee).toHaveBeenCalledWith(employeeUser);
      expect(prisma.timeAdjustmentRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1' }),
      });
    });

    it('rejects when relatedEventId points to a TimeEvent that does not belong to the caller\'s own employee (404, not silently accepted)', async () => {
      prisma.timeEvent.findFirst.mockResolvedValue(null); // event exists but belongs to someone else, or doesn't exist

      await expect(service.create(employeeUser, baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.timeAdjustmentRequest.create).not.toHaveBeenCalled();
    });

    it('rejects CORRECT_TIME/REMOVE_PUNCH without relatedEventId', async () => {
      await expect(service.create(employeeUser, { ...baseDto, relatedEventId: undefined })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects ADD_MISSING_PUNCH without requestedEventType/requestedTime', async () => {
      await expect(
        service.create(employeeUser, { targetDate: '2026-09-14', type: 'ADD_MISSING_PUNCH', reason: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uploads an attachment via FilesService with the ADJUSTMENT_ATTACHMENT purpose when provided', async () => {
      prisma.timeEvent.findFirst.mockResolvedValue({ id: 'event-1', employeeId: 'employee-1' });
      files.upload.mockResolvedValue({ id: 'asset-1' });
      prisma.timeAdjustmentRequest.create.mockResolvedValue({ id: 'req-1' });
      const attachment = { buffer: Buffer.from('x'), originalname: 'f.pdf', mimetype: 'application/pdf', size: 1 };

      await service.create(employeeUser, baseDto, attachment);

      expect(files.upload).toHaveBeenCalledWith('company-1', 'user-1', attachment, 'ADJUSTMENT_ATTACHMENT');
      expect(prisma.timeAdjustmentRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attachmentAssetId: 'asset-1' }),
      });
    });

    it('propagates resolveOwnEmployee rejection for a login with no linked employee', async () => {
      timeManagementAuth.resolveOwnEmployee.mockRejectedValue(new ForbiddenException('sem vínculo'));
      await expect(service.create(employeeUser, baseDto)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING request owned by the caller', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue({ id: 'req-1', employeeId: 'employee-1', status: 'PENDING' });
      prisma.timeAdjustmentRequest.update.mockResolvedValue({ id: 'req-1', status: 'CANCELLED' });

      const result = await service.cancel(employeeUser, 'req-1');

      expect(result.status).toBe('CANCELLED');
    });

    it('404s when the request does not belong to the caller\'s own employee', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue(null);
      await expect(service.cancel(employeeUser, 'req-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects cancelling an already-processed request', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue({ id: 'req-1', employeeId: 'employee-1', status: 'APPROVED' });
      await expect(service.cancel(employeeUser, 'req-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('approve', () => {
    const pendingRequest = {
      id: 'req-1', companyId: 'company-1', employeeId: 'employee-1', status: 'PENDING',
      relatedEventId: 'event-1', requestedEventType: 'CLOCK_IN', requestedTime: new Date('2026-09-14T12:00:00Z'), reason: 'orig reason',
    };

    it('the direct manager of the same company can approve, generating a new TimeEvent + TimeCorrection and never touching the original event', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.timeEvent.findUnique.mockResolvedValue({ id: 'event-1', type: 'CLOCK_IN', serverRecordedAt: new Date('2026-09-14T08:00:00Z') });
      const tx = {
        timeEvent: { create: jest.fn().mockResolvedValue({ id: 'event-new', type: 'CLOCK_IN', serverRecordedAt: pendingRequest.requestedTime }) },
        timeCorrection: { create: jest.fn().mockResolvedValue({ id: 'correction-1' }) },
        timeAdjustmentRequest: { update: jest.fn().mockResolvedValue({ id: 'req-1', status: 'APPROVED' }) },
      };
      const { runTenantInteractiveTransaction } = jest.requireMock('../prisma/tenant-rls.extension');
      (runTenantInteractiveTransaction as jest.Mock).mockImplementationOnce((_p: unknown, fn: (tx: unknown) => unknown) => fn(tx));

      const result = await service.approve(managerUser, 'req-1', 'ok');

      expect(timeManagementAuth.assertCanManage).toHaveBeenCalledWith(managerUser, 'employee-1');
      // Nunca uma escrita em prisma.timeEvent.update/delete sobre o evento original — só CREATE.
      expect(tx.timeEvent.create).toHaveBeenCalledTimes(1);
      expect(tx.timeCorrection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          originalEventId: 'event-1',
          originalValue: { type: 'CLOCK_IN', serverRecordedAt: '2026-09-14T08:00:00.000Z' },
          correctedEventId: 'event-new',
        }),
      });
      expect(tx.timeAdjustmentRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: expect.objectContaining({ status: 'APPROVED' }),
      });
      expect(result).toEqual({ id: 'correction-1' });
    });

    it('a manager/admin from another company gets 404 (assertCanManage propagates)', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue(null); // companyId filter excludes it
      await expect(service.approve(adminUser, 'req-1', undefined)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a login that does not manage the target employee gets 404 (assertCanManage propagates)', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue(pendingRequest);
      timeManagementAuth.assertCanManage.mockRejectedValue(new NotFoundException('não encontrado'));
      await expect(service.approve(managerUser, 'req-1', undefined)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('an already-processed request cannot be reprocessed (approve a second time throws)', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      await expect(service.approve(managerUser, 'req-1', undefined)).rejects.toBeInstanceOf(ConflictException);
    });

    it('preserves originalValue as JsonNull when there is no relatedEventId (a pure ADD_MISSING_PUNCH, nothing to snapshot)', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue({ ...pendingRequest, relatedEventId: null });
      const tx = {
        timeEvent: { create: jest.fn().mockResolvedValue({ id: 'event-new', type: 'CLOCK_IN', serverRecordedAt: pendingRequest.requestedTime }) },
        timeCorrection: { create: jest.fn().mockResolvedValue({ id: 'correction-1' }) },
        timeAdjustmentRequest: { update: jest.fn().mockResolvedValue({}) },
      };
      const { runTenantInteractiveTransaction } = jest.requireMock('../prisma/tenant-rls.extension');
      (runTenantInteractiveTransaction as jest.Mock).mockImplementationOnce((_p: unknown, fn: (tx: unknown) => unknown) => fn(tx));

      await service.approve(managerUser, 'req-1', undefined);

      expect(prisma.timeEvent.findUnique).not.toHaveBeenCalled();
      expect(tx.timeCorrection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ originalEventId: null }),
      });
    });
  });

  describe('reject', () => {
    const pendingRequest = { id: 'req-1', companyId: 'company-1', employeeId: 'employee-1', status: 'PENDING' };

    it('requires a reviewNote', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue(pendingRequest);
      await expect(service.reject(managerUser, 'req-1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a pending request with a reviewNote', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.timeAdjustmentRequest.update.mockResolvedValue({ id: 'req-1', status: 'REJECTED' });

      const result = await service.reject(managerUser, 'req-1', 'sem evidência suficiente');

      expect(result.status).toBe('REJECTED');
    });

    it('an already-processed request cannot be reprocessed (reject a second time throws)', async () => {
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue({ ...pendingRequest, status: 'REJECTED' });
      await expect(service.reject(managerUser, 'req-1', 'motivo')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('proactiveCorrect', () => {
    it('checks assertCanManage before creating anything, then reuses approve() — same audit trail, no separate silent write path', async () => {
      prisma.timeEvent.findFirst.mockResolvedValue({ id: 'event-1', employeeId: 'employee-2' });
      prisma.timeAdjustmentRequest.create.mockResolvedValue({
        id: 'req-2', companyId: 'company-1', employeeId: 'employee-2', status: 'PENDING', relatedEventId: 'event-1',
      });
      prisma.timeAdjustmentRequest.findFirst.mockResolvedValue({
        id: 'req-2', companyId: 'company-1', employeeId: 'employee-2', status: 'PENDING', relatedEventId: 'event-1', reason: 'correção administrativa',
      });
      const tx = {
        timeEvent: { create: jest.fn().mockResolvedValue({ id: 'event-new', type: 'CLOCK_IN', serverRecordedAt: new Date() }) },
        timeCorrection: { create: jest.fn().mockResolvedValue({ id: 'correction-2' }) },
        timeAdjustmentRequest: { update: jest.fn().mockResolvedValue({}) },
      };
      const { runTenantInteractiveTransaction } = jest.requireMock('../prisma/tenant-rls.extension');
      (runTenantInteractiveTransaction as jest.Mock).mockImplementationOnce((_p: unknown, fn: (tx: unknown) => unknown) => fn(tx));

      await service.proactiveCorrect(managerUser, 'employee-2', {
        targetDate: '2026-09-14', type: 'CORRECT_TIME', relatedEventId: 'event-1', requestedEventType: 'CLOCK_IN', requestedTime: '2026-09-14T08:00:00Z', reason: 'correção administrativa',
      } as any);

      expect(timeManagementAuth.assertCanManage).toHaveBeenCalledWith(managerUser, 'employee-2');
      expect(prisma.timeAdjustmentRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ employeeId: 'employee-2', status: 'PENDING' }),
      });
      expect(tx.timeCorrection.create).toHaveBeenCalled(); // mesma trilha de auditoria do fluxo normal de aprovação
    });

    it('never creates the request at all when the caller cannot manage the target employee', async () => {
      timeManagementAuth.assertCanManage.mockRejectedValue(new NotFoundException('não encontrado'));
      await expect(
        service.proactiveCorrect(managerUser, 'employee-2', { targetDate: '2026-09-14', type: 'CORRECT_TIME', relatedEventId: 'event-1', reason: 'x' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.timeAdjustmentRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('listForAdmin', () => {
    it("ADMIN sees the whole company (no employeeId filter)", async () => {
      timeManagementAuth.getManageableEmployeeIds.mockResolvedValue('ALL');
      prisma.timeAdjustmentRequest.findMany.mockResolvedValue([]);
      prisma.timeAdjustmentRequest.count.mockResolvedValue(0);

      await service.listForAdmin(adminUser);

      expect(prisma.timeAdjustmentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('a manager sees only requests from their direct reports', async () => {
      timeManagementAuth.getManageableEmployeeIds.mockResolvedValue(['report-1', 'report-2']);
      prisma.timeAdjustmentRequest.findMany.mockResolvedValue([]);
      prisma.timeAdjustmentRequest.count.mockResolvedValue(0);

      await service.listForAdmin(managerUser);

      expect(prisma.timeAdjustmentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employeeId: { in: ['report-1', 'report-2'] } } }),
      );
    });

    it('short-circuits to an empty page without querying when the caller manages nobody', async () => {
      timeManagementAuth.getManageableEmployeeIds.mockResolvedValue([]);
      const result = await service.listForAdmin(managerUser);
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
      expect(prisma.timeAdjustmentRequest.findMany).not.toHaveBeenCalled();
    });
  });
});
