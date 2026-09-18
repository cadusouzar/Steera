import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { TimeJustificationsService } from './time-justifications.service';

const employeeUser: AuthenticatedUser = {
  userId: 'user-1', companyId: 'company-1', role: 'EMPLOYEE', modules: ['RH'], mustChangePassword: false, hasFullPontoAccess: true, permissions: {},
};
const managerUser: AuthenticatedUser = {
  userId: 'user-manager', companyId: 'company-1', role: 'EMPLOYEE', modules: ['RH'], mustChangePassword: false, hasFullPontoAccess: true, permissions: {},
};
const adminUser: AuthenticatedUser = {
  userId: 'user-admin', companyId: 'company-1', role: 'ADMIN', modules: ['RH'], mustChangePassword: false, hasFullPontoAccess: true, permissions: {},
};

const employee = { id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' };
const attachment = { buffer: Buffer.from('x'), originalname: 'atestado.pdf', mimetype: 'application/pdf', size: 10 };

describe('TimeJustificationsService', () => {
  let service: TimeJustificationsService;
  let prisma: { timeJustification: Record<string, jest.Mock> };
  let files: { upload: jest.Mock };
  let timeManagementAuth: {
    resolveOwnEmployee: jest.Mock;
    assertCanManage: jest.Mock;
    getManageableEmployeeIds: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      timeJustification: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    };
    files = { upload: jest.fn() };
    timeManagementAuth = {
      resolveOwnEmployee: jest.fn().mockResolvedValue(employee),
      assertCanManage: jest.fn().mockResolvedValue(undefined),
      getManageableEmployeeIds: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        TimeJustificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FilesService, useValue: files },
        { provide: TimeManagementAuthService, useValue: timeManagementAuth },
      ],
    }).compile();
    service = module.get(TimeJustificationsService);
  });

  describe('create', () => {
    it('creates a justification for the caller\'s own employee, never trusting an employeeId from the DTO', async () => {
      prisma.timeJustification.create.mockResolvedValue({ id: 'just-1', attachmentAssetId: null });

      await service.create(employeeUser, { type: 'ABSENCE', description: 'consulta médica' } as any);

      expect(timeManagementAuth.resolveOwnEmployee).toHaveBeenCalledWith(employeeUser);
      expect(prisma.timeJustification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1' }),
      });
    });

    it('rejects MEDICAL_CERTIFICATE without an attachment', async () => {
      await expect(
        service.create(employeeUser, { type: 'MEDICAL_CERTIFICATE', description: 'atestado' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.timeJustification.create).not.toHaveBeenCalled();
    });

    it('accepts MEDICAL_CERTIFICATE with an attachment, uploading via FilesService with the JUSTIFICATION_ATTACHMENT purpose', async () => {
      files.upload.mockResolvedValue({ id: 'asset-1' });
      prisma.timeJustification.create.mockResolvedValue({ id: 'just-1', attachmentAssetId: 'asset-1' });

      const result = await service.create(employeeUser, { type: 'MEDICAL_CERTIFICATE', description: 'atestado' } as any, attachment);

      expect(files.upload).toHaveBeenCalledWith('company-1', 'user-1', attachment, 'JUSTIFICATION_ATTACHMENT');
      expect(result.downloadUrl).not.toBeNull();
    });

    it('propagates a FilesService rejection (invalid format / over size limit) without creating a justification', async () => {
      files.upload.mockRejectedValue(new BadRequestException('Tipo de arquivo não suportado'));
      await expect(
        service.create(employeeUser, { type: 'MEDICAL_CERTIFICATE', description: 'atestado' } as any, attachment),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.timeJustification.create).not.toHaveBeenCalled();
    });

    it('never auto-approves — status is always whatever the schema default is (PENDING), regardless of having an attachment or not', async () => {
      prisma.timeJustification.create.mockResolvedValue({ id: 'just-1', attachmentAssetId: null });
      await service.create(employeeUser, { type: 'OTHER', description: 'x' } as any);
      const createCall = prisma.timeJustification.create.mock.calls[0][0];
      expect(createCall.data.status).toBeUndefined(); // nunca setado explicitamente aqui — deixa o default do schema (PENDING) decidir
    });

    it('other types accept submission without an attachment', async () => {
      prisma.timeJustification.create.mockResolvedValue({ id: 'just-1', attachmentAssetId: null });
      await expect(service.create(employeeUser, { type: 'ABSENCE', description: 'x' } as any)).resolves.toBeDefined();
    });

    it('propagates resolveOwnEmployee rejection for a login with no linked employee', async () => {
      timeManagementAuth.resolveOwnEmployee.mockRejectedValue(new ForbiddenException('sem vínculo'));
      await expect(service.create(employeeUser, { type: 'ABSENCE', description: 'x' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listOwn / listForAdmin — attachment token gating', () => {
    it('listOwn attaches a fresh download token only for records that actually have an attachment', async () => {
      prisma.timeJustification.findMany.mockResolvedValue([
        { id: 'just-1', attachmentAssetId: 'asset-1' },
        { id: 'just-2', attachmentAssetId: null },
      ]);
      const result = await service.listOwn(employeeUser);
      expect(result[0].downloadUrl).toEqual(expect.any(String));
      expect(result[1].downloadUrl).toBeNull();
    });

    it('listForAdmin as a manager only queries the employees they can manage — never resolves a token for anyone outside that set, because the query itself never returns those rows', async () => {
      timeManagementAuth.getManageableEmployeeIds.mockResolvedValue(['report-1']);
      prisma.timeJustification.findMany.mockResolvedValue([{ id: 'just-1', employeeId: 'report-1', attachmentAssetId: 'asset-1' }]);
      prisma.timeJustification.count.mockResolvedValue(1);

      await service.listForAdmin(managerUser);

      expect(prisma.timeJustification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employeeId: { in: ['report-1'] } } }),
      );
    });

    it('listForAdmin short-circuits to an empty page without querying when the caller manages nobody', async () => {
      timeManagementAuth.getManageableEmployeeIds.mockResolvedValue([]);
      const result = await service.listForAdmin(managerUser);
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
      expect(prisma.timeJustification.findMany).not.toHaveBeenCalled();
    });

    it('ADMIN sees the whole company (no employeeId filter)', async () => {
      timeManagementAuth.getManageableEmployeeIds.mockResolvedValue('ALL');
      prisma.timeJustification.findMany.mockResolvedValue([]);
      prisma.timeJustification.count.mockResolvedValue(0);
      await service.listForAdmin(adminUser);
      expect(prisma.timeJustification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  describe('approve / reject', () => {
    const pending = { id: 'just-1', companyId: 'company-1', employeeId: 'employee-1', status: 'PENDING' };

    it('a direct manager can approve — only updates status/review fields, never touches TimeEvent (no such call exists in this service at all)', async () => {
      prisma.timeJustification.findFirst.mockResolvedValue(pending);
      prisma.timeJustification.update.mockResolvedValue({ ...pending, status: 'APPROVED' });

      const result = await service.approve(managerUser, 'just-1', 'confirmado');

      expect(timeManagementAuth.assertCanManage).toHaveBeenCalledWith(managerUser, 'employee-1');
      expect(prisma.timeJustification.update).toHaveBeenCalledWith({
        where: { id: 'just-1' },
        data: expect.objectContaining({ status: 'APPROVED', reviewedByUserId: 'user-manager' }),
      });
      expect(result.status).toBe('APPROVED');
    });

    it('a manager/admin from another company gets 404', async () => {
      prisma.timeJustification.findFirst.mockResolvedValue(null); // companyId filter excludes it
      await expect(service.approve(adminUser, 'just-1', undefined)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a login that does not manage the target employee gets 404 (assertCanManage propagates)', async () => {
      prisma.timeJustification.findFirst.mockResolvedValue(pending);
      timeManagementAuth.assertCanManage.mockRejectedValue(new NotFoundException('não encontrado'));
      await expect(service.approve(managerUser, 'just-1', undefined)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejection requires a reviewNote', async () => {
      prisma.timeJustification.findFirst.mockResolvedValue(pending);
      await expect(service.reject(managerUser, 'just-1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects with a reviewNote — history is preserved, never deleted (an update, not a delete)', async () => {
      prisma.timeJustification.findFirst.mockResolvedValue(pending);
      prisma.timeJustification.update.mockResolvedValue({ ...pending, status: 'REJECTED' });

      const result = await service.reject(managerUser, 'just-1', 'sem evidência suficiente');

      expect(prisma.timeJustification.update).toHaveBeenCalled(); // nunca delete
      expect(result.status).toBe('REJECTED');
    });

    it('an already-processed justification cannot be reprocessed (approve a second time throws)', async () => {
      prisma.timeJustification.findFirst.mockResolvedValue({ ...pending, status: 'APPROVED' });
      await expect(service.approve(managerUser, 'just-1', undefined)).rejects.toBeInstanceOf(ConflictException);
    });

    it('an already-processed justification cannot be reprocessed (reject a second time throws)', async () => {
      prisma.timeJustification.findFirst.mockResolvedValue({ ...pending, status: 'REJECTED' });
      await expect(service.reject(managerUser, 'just-1', 'motivo')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
