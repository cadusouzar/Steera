import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { verifyDownloadToken } from './download-token.util';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

jest.mock('./download-token.util', () => ({
  verifyDownloadToken: jest.fn(),
}));

describe('FilesController', () => {
  let controller: FilesController;
  let filesService: { assertExistsForCompany: jest.Mock; streamPath: jest.Mock };
  let auditLog: { record: jest.Mock };
  const verifyDownloadTokenMock = verifyDownloadToken as jest.Mock;

  const user: AuthenticatedUser = {
    userId: 'user-1',
    companyId: 'company-1',
    role: 'ADMIN',
    modules: [],
    mustChangePassword: false,
  };

  function fakeResponse() {
    return { setHeader: jest.fn(), pipe: jest.fn() } as unknown as import('express').Response;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    filesService = { assertExistsForCompany: jest.fn(), streamPath: jest.fn() };
    auditLog = { record: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: FilesService, useValue: filesService },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    controller = module.get(FilesController);
  });

  it('rejects when no token is provided at all', async () => {
    const res = fakeResponse();
    await expect(controller.download('asset-1', '', user, res)).rejects.toBeInstanceOf(NotFoundException);
    expect(verifyDownloadTokenMock).not.toHaveBeenCalled();
    expect(filesService.assertExistsForCompany).not.toHaveBeenCalled();
  });

  it('rejects when the token does not verify (wrong asset id or expired)', async () => {
    verifyDownloadTokenMock.mockReturnValue(false);
    const res = fakeResponse();
    await expect(controller.download('asset-1', 'bad-token', user, res)).rejects.toBeInstanceOf(NotFoundException);
    expect(verifyDownloadTokenMock).toHaveBeenCalledWith('asset-1', 'bad-token');
    expect(filesService.assertExistsForCompany).not.toHaveBeenCalled();
  });

  it('streams the file and sets response headers when the token is valid and the asset belongs to the caller company', async () => {
    verifyDownloadTokenMock.mockReturnValue(true);
    filesService.assertExistsForCompany.mockResolvedValue({
      id: 'asset-1',
      companyId: 'company-1',
      mimeType: 'application/pdf',
      originalFilename: 'contrato.pdf',
      storagePath: 'attachments/uuid.pdf',
      purpose: 'ADJUSTMENT_ATTACHMENT',
    });
    const pipeMock = jest.fn();
    filesService.streamPath.mockResolvedValue({ pipe: pipeMock });
    const res = fakeResponse();

    await controller.download('asset-1', 'good-token', user, res);

    expect(filesService.assertExistsForCompany).toHaveBeenCalledWith('asset-1', 'company-1');
    expect(auditLog.record).toHaveBeenCalledWith({
      companyId: 'company-1',
      action: 'FILE_ACCESSED',
      performedByUserId: 'user-1',
      metadata: { assetId: 'asset-1', purpose: 'ADJUSTMENT_ATTACHMENT' },
    });
    expect(filesService.streamPath).toHaveBeenCalledWith('attachments/uuid.pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline; filename="contrato.pdf"');
    expect(pipeMock).toHaveBeenCalledWith(res);
  });

  it('never resolves an asset belonging to a different company (assertExistsForCompany is always scoped to the caller)', async () => {
    verifyDownloadTokenMock.mockReturnValue(true);
    filesService.assertExistsForCompany.mockRejectedValue(new NotFoundException('Arquivo não encontrado'));
    const res = fakeResponse();

    await expect(controller.download('asset-1', 'good-token', user, res)).rejects.toBeInstanceOf(NotFoundException);
    expect(filesService.assertExistsForCompany).toHaveBeenCalledWith('asset-1', 'company-1');
  });
});
