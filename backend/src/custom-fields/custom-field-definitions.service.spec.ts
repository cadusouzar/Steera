import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CustomFieldType } from '@prisma/client';
import { CustomFieldDefinitionsService } from './custom-field-definitions.service';

function makeDefinition(overrides: Partial<any> = {}) {
  return {
    id: 'def1', companyId: 'c1', entity: 'client', displayName: 'Segmento',
    columnName: 'custom_segmento', type: CustomFieldType.TEXT, required: false,
    defaultValue: null, description: null, configuration: null, displayOrder: 0,
    active: true, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

describe('CustomFieldDefinitionsService', () => {
  let prisma: any;
  let companyContext: { getCurrentCompanyId: jest.Mock };
  let service: CustomFieldDefinitionsService;

  beforeEach(() => {
    prisma = {
      customFieldDefinition: {
        findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(), create: jest.fn(),
      },
      $executeRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
      $queryRawUnsafe: jest.fn(),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    companyContext = { getCurrentCompanyId: jest.fn().mockResolvedValue('c1') };
    service = new CustomFieldDefinitionsService(prisma, companyContext as any);
  });

  describe('create', () => {
    it('rejeita SELECT sem opções', async () => {
      await expect(
        service.create({ entity: 'client', displayName: 'Segmento', type: CustomFieldType.SELECT } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('cria a coluna física e o metadado dentro da mesma transação', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([]);
      prisma.customFieldDefinition.create.mockResolvedValue(makeDefinition());

      const result = await service.create({
        entity: 'client', displayName: 'Segmento', type: CustomFieldType.TEXT,
      } as any);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('ALTER TABLE "Client" ADD COLUMN "custom_segmento" TEXT');
      expect(prisma.customFieldDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ columnName: 'custom_segmento', companyId: 'c1' }) }),
      );
      expect(result.columnName).toBe('custom_segmento');
    });
  });

  describe('deactivate/reactivate', () => {
    it('rejeita desativar um campo já desativado', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ active: false }));
      await expect(service.deactivate('def1')).rejects.toThrow(ConflictException);
    });

    it('desativa sem nenhum DDL', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ active: true }));
      prisma.customFieldDefinition.update.mockResolvedValue(makeDefinition({ active: false }));
      await service.deactivate('def1');
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
      expect(prisma.customFieldDefinition.update).toHaveBeenCalledWith({ where: { id: 'def1' }, data: { active: false } });
    });

    it('reativa mantendo a configuração original', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ active: false, required: true }));
      prisma.customFieldDefinition.update.mockResolvedValue(makeDefinition({ active: true, required: true }));
      await service.reactivate('def1');
      expect(prisma.customFieldDefinition.update).toHaveBeenCalledWith({ where: { id: 'def1' }, data: { active: true } });
    });

    it('rejeita reativar um campo já ativo', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ active: true }));
      await expect(service.reactivate('def1')).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('lança 404 pra um campo de outra empresa', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(null);
      await expect(service.remove('def-de-outra-empresa')).rejects.toThrow(NotFoundException);
    });

    it('remove a coluna física e o metadado juntos', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition());
      await service.remove('def1');
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('ALTER TABLE "Client" DROP COLUMN "custom_segmento"');
      expect(prisma.customFieldDefinition.delete).toHaveBeenCalledWith({ where: { id: 'def1' } });
    });
  });

  describe('countFilledValues', () => {
    it('conta quantos registros têm valor preenchido na coluna', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition());
      prisma.$queryRawUnsafe.mockResolvedValue([{ count: 3n }]);
      const count = await service.countFilledValues('def1');
      expect(count).toBe(3);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        'SELECT count(*)::bigint as count FROM "Client" WHERE "custom_segmento" IS NOT NULL',
      );
    });
  });
});
