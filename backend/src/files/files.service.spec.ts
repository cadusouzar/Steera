import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { join } from 'path';
import { FileAssetPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService } from './files.service';

jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ isFile: () => true }),
}));

// Preserva o resto do módulo real 'fs' (o próprio Prisma Client usa fs.existsSync internamente ao
// ser carregado) — só substitui createReadStream, que é o único ponto que FilesService chama.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createReadStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
}));

// files.service.ts importa `fromBuffer` (renomeado localmente para `fileTypeFromBuffer`) — a
// versão pinada v16.x do pacote usa esse nome, não `fileTypeFromBuffer` (só existe no v17+ ESM-only
// — ver o comentário grande em files.service.ts). O mock precisa espelhar o export real.
jest.mock('file-type', () => ({
  fromBuffer: jest.fn(),
}));

jest.mock('sharp', () => {
  const toBuffer = jest.fn().mockResolvedValue(Buffer.from('stripped-image-bytes'));
  const rotate = jest.fn().mockReturnValue({ toBuffer });
  const sharpFn = jest.fn().mockReturnValue({ rotate });
  return { __esModule: true, default: sharpFn };
});

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn().mockReturnValue('11111111-1111-1111-1111-111111111111'),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mkdir, writeFile, stat } = jest.requireMock('fs/promises') as {
  mkdir: jest.Mock;
  writeFile: jest.Mock;
  stat: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createReadStream } = jest.requireMock('fs') as { createReadStream: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer: fileTypeFromBuffer } = jest.requireMock('file-type') as { fromBuffer: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharpMock = jest.requireMock('sharp').default as jest.Mock;

describe('FilesService', () => {
  let service: FilesService;
  let prisma: { fileAsset: Record<string, jest.Mock> };

  beforeEach(async () => {
    jest.clearAllMocks();
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    stat.mockResolvedValue({ isFile: () => true });
    createReadStream.mockReturnValue({ pipe: jest.fn() });

    prisma = {
      fileAsset: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'asset-1', ...data })),
        findFirst: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [FilesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(FilesService);
  });

  const pdfFile = () => ({
    buffer: Buffer.from('%PDF-1.4 fake pdf content'),
    originalname: 'contrato.pdf',
    mimetype: 'application/pdf',
    size: 25,
  });

  describe('upload', () => {
    it('rejects a file above the configured max size before ever inspecting its bytes', async () => {
      fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
      const file = { ...pdfFile(), size: 10 * 1024 * 1024 };

      await expect(
        service.upload('company-1', 'user-1', file, FileAssetPurpose.ADJUSTMENT_ATTACHMENT, 5 * 1024 * 1024),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(fileTypeFromBuffer).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    });

    it('rejects a MIME type not on the allow-list even when the client-declared mimetype lies', async () => {
      // Cliente declara application/pdf, mas o sniff de magic bytes revela texto puro.
      fileTypeFromBuffer.mockResolvedValue({ mime: 'text/plain', ext: 'txt' });
      const file = { buffer: Buffer.from('isto e so texto puro'), originalname: 'fake.pdf', mimetype: 'application/pdf', size: 20 };

      await expect(
        service.upload('company-1', 'user-1', file, FileAssetPurpose.ADJUSTMENT_ATTACHMENT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(writeFile).not.toHaveBeenCalled();
      expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    });

    // Regressão de um bug real encontrado na verificação manual desta task (14/09/2026): o código
    // original do brief fazia `detected?.mime ?? file.mimetype`, caindo de volta pro mimetype
    // DECLARADO (controlado pelo atacante) sempre que `fileTypeFromBuffer` não reconhece a
    // assinatura real dos bytes — que é exatamente o que acontece pra texto puro sem nenhum magic
    // number conhecido, não só pra variantes malformadas de um formato válido. Um arquivo de texto
    // puro se passando por `application/pdf` passava pelo allow-list sem nenhuma detecção real.
    // Confirmado empiricamente (ver task-2-report.md) e corrigido: `realMime` nunca mais cai de
    // volta pro valor declarado — undefined/não reconhecido é sempre rejeitado.
    it('rejects the upload when magic-byte sniffing cannot recognize the file at all (never falls back to the declared mimetype)', async () => {
      fileTypeFromBuffer.mockResolvedValue(undefined);
      const file = {
        buffer: Buffer.from('isto e apenas texto puro, sem nenhum magic number reconhecivel'),
        originalname: 'fake.pdf',
        mimetype: 'application/pdf', // mentira do atacante — não deve ser usada em nenhuma decisão de segurança
        size: 60,
      };

      await expect(
        service.upload('company-1', 'user-1', file, FileAssetPurpose.ADJUSTMENT_ATTACHMENT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(writeFile).not.toHaveBeenCalled();
      expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    });

    it('accepts a real PDF and persists a FileAsset with the correct fields', async () => {
      fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
      const file = pdfFile();

      const result = await service.upload('company-1', 'user-1', file, FileAssetPurpose.ADJUSTMENT_ATTACHMENT);

      expect(sharpMock).not.toHaveBeenCalled(); // PDFs não passam por sharp — só imagens
      expect(prisma.fileAsset.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          uploadedByUserId: 'user-1',
          originalFilename: 'contrato.pdf',
          mimeType: 'application/pdf',
          sizeBytes: file.buffer.length,
          storagePath: join('attachments', '11111111-1111-1111-1111-111111111111.pdf'),
          purpose: 'ADJUSTMENT_ATTACHMENT',
        },
      });
      expect(result).toMatchObject({ id: 'asset-1', purpose: 'ADJUSTMENT_ATTACHMENT' });
    });

    it('accepts a real JPEG, strips EXIF via sharp, and persists the re-encoded buffer size', async () => {
      fileTypeFromBuffer.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
      const file = { buffer: Buffer.from('fake-jpeg-bytes-with-exif'), originalname: 'foto.jpg', mimetype: 'image/jpeg', size: 26 };

      await service.upload('company-1', 'user-1', file, FileAssetPurpose.TIME_PUNCH_PHOTO);

      expect(sharpMock).toHaveBeenCalledWith(file.buffer);
      const strippedBuffer = Buffer.from('stripped-image-bytes');
      expect(writeFile).toHaveBeenCalledWith(
        join(process.cwd(), 'storage', 'attachments', '11111111-1111-1111-1111-111111111111.jpg'),
        strippedBuffer,
      );
      expect(prisma.fileAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sizeBytes: strippedBuffer.length, mimeType: 'image/jpeg' }),
      });
    });

    it('accepts a real PNG', async () => {
      fileTypeFromBuffer.mockResolvedValue({ mime: 'image/png', ext: 'png' });
      const file = { buffer: Buffer.from('fake-png-bytes'), originalname: 'foto.png', mimetype: 'image/png', size: 14 };

      await service.upload('company-1', 'user-1', file, FileAssetPurpose.TIME_PUNCH_PHOTO);

      expect(prisma.fileAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ mimeType: 'image/png' }) });
    });

    it('never stores the file under its original filename on disk — always a fresh random UUID', async () => {
      fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
      const file = { ...pdfFile(), originalname: '../../../etc/passwd.pdf' };

      await service.upload('company-1', 'user-1', file, FileAssetPurpose.ADJUSTMENT_ATTACHMENT);

      const [writtenPath] = writeFile.mock.calls[0];
      expect(writtenPath).not.toContain('passwd');
      expect(writtenPath).not.toContain('..');
      expect(writtenPath).toBe(join(process.cwd(), 'storage', 'attachments', '11111111-1111-1111-1111-111111111111.pdf'));
    });

    it('sanitizes path-traversal/special characters out of the originalFilename metadata field', async () => {
      fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
      const file = { ...pdfFile(), originalname: '../../../etc/passwd; rm -rf.pdf' };

      await service.upload('company-1', 'user-1', file, FileAssetPurpose.ADJUSTMENT_ATTACHMENT);

      const [{ data }] = prisma.fileAsset.create.mock.calls[0];
      expect(data.originalFilename).not.toContain('/');
      expect(data.originalFilename).not.toContain(';');
      expect(data.originalFilename).not.toContain(' ');
    });

    it('creates the storage directory before writing (mkdir recursive)', async () => {
      fileTypeFromBuffer.mockResolvedValue({ mime: 'application/pdf', ext: 'pdf' });
      await service.upload('company-1', 'user-1', pdfFile(), FileAssetPurpose.ADJUSTMENT_ATTACHMENT);
      expect(mkdir).toHaveBeenCalledWith(join(process.cwd(), 'storage', 'attachments'), { recursive: true });
    });
  });

  describe('assertExistsForCompany', () => {
    it('returns the asset when it belongs to the given company', async () => {
      prisma.fileAsset.findFirst.mockResolvedValue({ id: 'asset-1', companyId: 'company-1' });
      const asset = await service.assertExistsForCompany('asset-1', 'company-1');
      expect(asset).toEqual({ id: 'asset-1', companyId: 'company-1' });
      expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith({ where: { id: 'asset-1', companyId: 'company-1' } });
    });

    it('throws NotFoundException when the asset does not exist for that company', async () => {
      prisma.fileAsset.findFirst.mockResolvedValue(null);
      await expect(service.assertExistsForCompany('asset-1', 'company-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('streamPath', () => {
    it('returns a readable stream for an existing file', async () => {
      const stream = await service.streamPath(join('attachments', 'existing.pdf'));
      expect(stat).toHaveBeenCalledWith(join(process.cwd(), 'storage', 'attachments', 'existing.pdf'));
      expect(createReadStream).toHaveBeenCalledWith(join(process.cwd(), 'storage', 'attachments', 'existing.pdf'));
      expect(stream).toBeDefined();
    });

    it('propagates the error when the file does not exist on disk', async () => {
      stat.mockRejectedValue(new Error('ENOENT'));
      await expect(service.streamPath(join('attachments', 'missing.pdf'))).rejects.toThrow('ENOENT');
    });
  });
});
