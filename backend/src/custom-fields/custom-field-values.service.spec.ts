import { BadRequestException } from '@nestjs/common';
import { CustomFieldType } from '@prisma/client';
import { CustomFieldValuesService } from './custom-field-values.service';

function makeDefinition(overrides: Partial<any> = {}) {
  return {
    id: 'def1', companyId: 'c1', entity: 'client', displayName: 'Segmento',
    columnName: 'custom_segmento', type: CustomFieldType.TEXT, required: false,
    defaultValue: null, description: null, configuration: null, displayOrder: 0,
    active: true, createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

describe('CustomFieldValuesService', () => {
  let prisma: {
    customFieldDefinition: { findMany: jest.Mock };
    $queryRawUnsafe: jest.Mock;
    $transaction: jest.Mock;
  };
  let companyContext: { getCurrentCompanyId: jest.Mock };
  let service: CustomFieldValuesService;

  beforeEach(() => {
    prisma = {
      customFieldDefinition: { findMany: jest.fn() },
      $queryRawUnsafe: jest.fn(),
      // Sem contexto de tenant (nenhum AsyncLocalStorage ativo neste teste unitário),
      // runTenantInteractiveTransaction cai direto em `prisma.$transaction(fn)` — mesmo padrão já
      // usado em clients.service.spec.ts.
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    companyContext = { getCurrentCompanyId: jest.fn().mockResolvedValue('c1') };
    service = new CustomFieldValuesService(prisma as any, companyContext as any);
  });

  describe('getValuesForRecords', () => {
    it('devolve mapa vazio sem nenhum id', async () => {
      const result = await service.getValuesForRecords('client', []);
      expect(result.size).toBe(0);
      expect(prisma.customFieldDefinition.findMany).not.toHaveBeenCalled();
    });

    it('não consulta o banco quando a empresa não tem campo ativo pra essa entidade', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([]);
      const result = await service.getValuesForRecords('client', ['rec1']);
      expect(result.size).toBe(0);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('busca as colunas certas e monta o mapa por id', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([makeDefinition()]);
      prisma.$queryRawUnsafe.mockResolvedValue([{ id: 'rec1', custom_segmento: 'Enterprise' }]);

      const result = await service.getValuesForRecords('client', ['rec1']);

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        'SELECT id, "custom_segmento" FROM "Client" WHERE id IN ($1)',
        'rec1',
      );
      expect(result.get('rec1')).toEqual({ custom_segmento: 'Enterprise' });
    });
  });

  describe('setValues', () => {
    // `setValues` busca as definições ativas via o próprio `tx` recebido (não mais via `prisma`
    // central) — reaproveita a MESMA transação/conexão do chamador em vez de abrir uma segunda.
    let tx: { $executeRawUnsafe: jest.Mock; customFieldDefinition: { findMany: jest.Mock } };
    beforeEach(() => {
      tx = { $executeRawUnsafe: jest.fn(), customFieldDefinition: { findMany: jest.fn() } };
    });

    it('não faz nada quando a entidade não tem campo ativo', async () => {
      tx.customFieldDefinition.findMany.mockResolvedValue([]);
      await service.setValues('client', 'rec1', { custom_segmento: 'x' }, tx as any);
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('rejeita uma chave que não corresponde a nenhum campo ativo', async () => {
      tx.customFieldDefinition.findMany.mockResolvedValue([makeDefinition()]);
      await expect(
        service.setValues('client', 'rec1', { custom_inexistente: 'x' }, tx as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('escreve só as colunas presentes no objeto — update parcial', async () => {
      tx.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({ columnName: 'custom_a' }),
        makeDefinition({ id: 'def2', columnName: 'custom_b' }),
      ]);
      await service.setValues('client', 'rec1', { custom_a: 'valor' }, tx as any);
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE "Client" SET "custom_a" = $1 WHERE id = $2',
        'valor',
        'rec1',
      );
    });

    it('rejeita valor não-numérico pra um campo NUMBER', async () => {
      tx.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({ type: CustomFieldType.NUMBER, columnName: 'custom_qtd' }),
      ]);
      await expect(
        service.setValues('client', 'rec1', { custom_qtd: 'abc' }, tx as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita valor fora da lista de opções pra um campo SELECT', async () => {
      tx.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({
          type: CustomFieldType.SELECT, columnName: 'custom_seg',
          configuration: { options: ['Pequeno', 'Médio'] },
        }),
      ]);
      await expect(
        service.setValues('client', 'rec1', { custom_seg: 'Enorme' }, tx as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita null pra um campo obrigatório', async () => {
      tx.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({ required: true, columnName: 'custom_seg' }),
      ]);
      await expect(
        service.setValues('client', 'rec1', { custom_seg: null }, tx as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('adiciona o cast ::text[] pra um campo MULTI_SELECT', async () => {
      tx.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({
          type: CustomFieldType.MULTI_SELECT, columnName: 'custom_tags',
          configuration: { options: ['A', 'B'] },
        }),
      ]);
      await service.setValues('client', 'rec1', { custom_tags: ['A', 'B'] }, tx as any);
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE "Client" SET "custom_tags" = $1::text[] WHERE id = $2',
        ['A', 'B'],
        'rec1',
      );
    });
  });

  describe('resolveValuesForCreate', () => {
    it('aplica o defaultValue quando o campo não é informado', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({ columnName: 'custom_seg', defaultValue: 'Pequeno' }),
      ]);
      const resolved = await service.resolveValuesForCreate('client', {});
      expect(resolved).toEqual({ custom_seg: 'Pequeno' });
    });

    it('rejeita quando um campo obrigatório não é informado e não tem defaultValue', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({ columnName: 'custom_seg', required: true, defaultValue: null }),
      ]);
      await expect(service.resolveValuesForCreate('client', {})).rejects.toThrow(BadRequestException);
    });

    it('o valor informado sempre tem prioridade sobre o defaultValue', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({ columnName: 'custom_seg', defaultValue: 'Pequeno' }),
      ]);
      const resolved = await service.resolveValuesForCreate('client', { custom_seg: 'Grande' });
      expect(resolved).toEqual({ custom_seg: 'Grande' });
    });

    it('rejeita null explícito pra um campo obrigatório sem defaultValue', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({ columnName: 'custom_seg', required: true, defaultValue: null }),
      ]);
      await expect(
        service.resolveValuesForCreate('client', { custom_seg: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita valor não-numérico pra um campo NUMBER', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({ type: CustomFieldType.NUMBER, columnName: 'custom_qtd' }),
      ]);
      await expect(
        service.resolveValuesForCreate('client', { custom_qtd: 'abc' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita valor fora da lista de opções pra um campo SELECT', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([
        makeDefinition({
          type: CustomFieldType.SELECT, columnName: 'custom_seg',
          configuration: { options: ['Pequeno', 'Médio'] },
        }),
      ]);
      await expect(
        service.resolveValuesForCreate('client', { custom_seg: 'Enorme' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita uma chave que não corresponde a nenhum campo ativo', async () => {
      prisma.customFieldDefinition.findMany.mockResolvedValue([makeDefinition()]);
      await expect(
        service.resolveValuesForCreate('client', { custom_inexistente: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
