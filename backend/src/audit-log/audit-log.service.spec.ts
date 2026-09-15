import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: { auditLog: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = { auditLog: { create: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [AuditLogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AuditLogService);
  });

  it('creates a row with all provided fields', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

    await service.record({
      companyId: 'company-1',
      action: 'FILE_ACCESSED',
      employeeId: 'employee-1',
      performedByUserId: 'user-1',
      metadata: { assetId: 'asset-1' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        action: 'FILE_ACCESSED',
        employeeId: 'employee-1',
        performedByUserId: 'user-1',
        metadata: { assetId: 'asset-1' },
      },
    });
  });

  it('creates a row with optional fields omitted', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'log-2' });

    await service.record({ companyId: 'company-1', action: 'PUNCH_DUPLICATE_REJECTED' });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        action: 'PUNCH_DUPLICATE_REJECTED',
        employeeId: undefined,
        performedByUserId: undefined,
        metadata: undefined,
      },
    });
  });

  it('never throws even if the write fails', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));

    await expect(service.record({ companyId: 'company-1', action: 'PUNCH_VALIDATION_REJECTED' })).resolves.toBeUndefined();
  });
});
