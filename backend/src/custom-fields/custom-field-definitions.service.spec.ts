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

  describe('update', () => {
    it('rejeita configuration.options vazio pra um campo SELECT já existente', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ type: CustomFieldType.SELECT }));
      await expect(
        service.update('def1', { configuration: { options: [] } } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.customFieldDefinition.update).not.toHaveBeenCalled();
    });

    it('rejeita configuration sem options pra um campo MULTI_SELECT já existente', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ type: CustomFieldType.MULTI_SELECT }));
      await expect(
        service.update('def1', { configuration: {} } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('aceita configuration.options preenchido pra um campo SELECT já existente', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ type: CustomFieldType.SELECT }));
      prisma.customFieldDefinition.update.mockResolvedValue(makeDefinition({ type: CustomFieldType.SELECT }));
      await service.update('def1', { configuration: { options: ['A', 'B'] } } as any);
      expect(prisma.customFieldDefinition.update).toHaveBeenCalled();
    });

    it('não exige options ao atualizar um campo TEXT sem mexer em configuration', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ type: CustomFieldType.TEXT }));
      prisma.customFieldDefinition.update.mockResolvedValue(makeDefinition({ type: CustomFieldType.TEXT }));
      await service.update('def1', { displayName: 'Novo nome' } as any);
      expect(prisma.customFieldDefinition.update).toHaveBeenCalled();
    });

    // `defaultValue: null` explícito precisa limpar o valor padrão de volta pra "nenhum" — o DTO
    // (`UpdateCustomFieldDefinitionDto`) passa `null` pela validação com `@ValidateIf`, e o Prisma
    // trata `null` no `data` como "define a coluna como NULL" (diferente de `undefined`, que ele
    // ignora por completo) — sem chamada nenhuma extra além do `update()` de sempre.
    it('limpa o defaultValue quando recebe null explícito', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(
        makeDefinition({ type: CustomFieldType.TEXT, defaultValue: 'Pequeno' }),
      );
      prisma.customFieldDefinition.update.mockResolvedValue(
        makeDefinition({ type: CustomFieldType.TEXT, defaultValue: null }),
      );
      const result = await service.update('def1', { defaultValue: null } as any);
      expect(prisma.customFieldDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ defaultValue: null }) }),
      );
      expect(result.defaultValue).toBeNull();
    });

    it('mantém o defaultValue atual quando o campo é omitido do body', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(
        makeDefinition({ type: CustomFieldType.TEXT, defaultValue: 'Pequeno' }),
      );
      prisma.customFieldDefinition.update.mockResolvedValue(
        makeDefinition({ type: CustomFieldType.TEXT, defaultValue: 'Pequeno' }),
      );
      await service.update('def1', { displayName: 'Segmento (renomeado)' } as any);
      const call = prisma.customFieldDefinition.update.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('defaultValue');
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
    it('conta quantos registros têm valor preenchido na coluna, dentro de uma transação de tenant', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition());
      prisma.$queryRawUnsafe.mockResolvedValue([{ count: 3n }]);
      const count = await service.countFilledValues('def1');
      expect(count).toBe(3);
      // A leitura precisa passar por `runTenantInteractiveTransaction` (nunca `this.prisma` direto)
      // pra resolver contra o schema físico certo — `$transaction` sendo chamado é a prova disso.
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        'SELECT count(*)::bigint as count FROM "Client" WHERE "custom_segmento" IS NOT NULL',
      );
    });
  });

  describe('countOptionUsage', () => {
    it('rejeita um campo que não é lista de opções', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(makeDefinition({ type: CustomFieldType.TEXT }));
      await expect(service.countOptionUsage('def1', 'Pequeno')).rejects.toThrow(BadRequestException);
    });

    it('conta quantos registros usam a opção, pra um campo SELECT (coluna = valor)', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(
        makeDefinition({ type: CustomFieldType.SELECT, columnName: 'custom_segmento' }),
      );
      prisma.$queryRawUnsafe.mockResolvedValue([{ count: 2n }]);

      const count = await service.countOptionUsage('def1', 'Pequeno');

      expect(count).toBe(2);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        'SELECT count(*)::bigint as count FROM "Client" WHERE "custom_segmento" = $1',
        'Pequeno',
      );
    });

    it('conta quantos registros usam a opção, pra um campo MULTI_SELECT (opção dentro do array)', async () => {
      prisma.customFieldDefinition.findFirst.mockResolvedValue(
        makeDefinition({ type: CustomFieldType.MULTI_SELECT, columnName: 'custom_interesses' }),
      );
      prisma.$queryRawUnsafe.mockResolvedValue([{ count: 5n }]);

      const count = await service.countOptionUsage('def1', 'RH');

      expect(count).toBe(5);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        'SELECT count(*)::bigint as count FROM "Client" WHERE $1 = ANY("custom_interesses")',
        'RH',
      );
    });
  });
});
