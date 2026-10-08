import { LegalAcceptanceService } from './legal-acceptance.service';
import { LEGAL_VERSIONS } from './legal-versions';

describe('LegalAcceptanceService', () => {
  let prisma: { legalAcceptance: { findMany: jest.Mock; createMany: jest.Mock } };
  let service: LegalAcceptanceService;

  beforeEach(() => {
    prisma = {
      legalAcceptance: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    service = new LegalAcceptanceService(prisma as any);
  });

  const currentFilter = {
    userId: 'u1',
    OR: [
      { document: 'TERMS', version: LEGAL_VERSIONS.TERMS.version },
      { document: 'PRIVACY', version: LEGAL_VERSIONS.PRIVACY.version },
    ],
  };

  describe('record', () => {
    it('grava TERMS e PRIVACY na versão atual, com IP e user agent', async () => {
      await service.record('u1', { ip: '10.0.0.1', userAgent: 'Mozilla/5.0' });
      expect(prisma.legalAcceptance.findMany).toHaveBeenCalledWith({ where: currentFilter, select: { document: true } });
      expect(prisma.legalAcceptance.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'u1', document: 'TERMS', version: 1, ip: '10.0.0.1', userAgent: 'Mozilla/5.0' },
          { userId: 'u1', document: 'PRIVACY', version: 1, ip: '10.0.0.1', userAgent: 'Mozilla/5.0' },
        ],
      });
    });

    it('não duplica o que já foi aceito na versão atual', async () => {
      prisma.legalAcceptance.findMany.mockResolvedValue([{ document: 'TERMS' }]);
      await service.record('u1', {});
      expect(prisma.legalAcceptance.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'u1', document: 'PRIVACY', version: 1, ip: null, userAgent: null }],
      });
    });

    it('não escreve nada quando os dois já estão aceitos', async () => {
      prisma.legalAcceptance.findMany.mockResolvedValue([{ document: 'TERMS' }, { document: 'PRIVACY' }]);
      await service.record('u1', {});
      expect(prisma.legalAcceptance.createMany).not.toHaveBeenCalled();
    });

    it('corta o user agent em 300 caracteres (coluna VarChar(300))', async () => {
      await service.record('u1', { userAgent: 'x'.repeat(500) });
      const data = prisma.legalAcceptance.createMany.mock.calls[0][0].data;
      expect(data[0].userAgent).toHaveLength(300);
    });

    it('usa o client de transação recebido em vez do PrismaService', async () => {
      const tx = { legalAcceptance: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() } };
      await service.record('u1', {}, tx as any);
      expect(tx.legalAcceptance.createMany).toHaveBeenCalled();
      expect(prisma.legalAcceptance.findMany).not.toHaveBeenCalled();
      expect(prisma.legalAcceptance.createMany).not.toHaveBeenCalled();
    });
  });

  describe('isPending', () => {
    it('true quando não há nenhuma linha da versão atual', async () => {
      await expect(service.isPending('u1')).resolves.toBe(true);
      expect(prisma.legalAcceptance.findMany).toHaveBeenCalledWith({ where: currentFilter, select: { document: true } });
    });

    it('true quando falta um dos documentos', async () => {
      prisma.legalAcceptance.findMany.mockResolvedValue([{ document: 'PRIVACY' }]);
      await expect(service.isPending('u1')).resolves.toBe(true);
    });

    it('false quando os dois documentos estão aceitos na versão atual', async () => {
      prisma.legalAcceptance.findMany.mockResolvedValue([{ document: 'TERMS' }, { document: 'PRIVACY' }]);
      await expect(service.isPending('u1')).resolves.toBe(false);
    });
  });
});
