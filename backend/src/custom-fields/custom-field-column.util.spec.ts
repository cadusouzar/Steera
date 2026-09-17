import { CustomFieldType } from '@prisma/client';
import {
  assertValidCustomColumnName,
  buildCustomColumnName,
  POSTGRES_TYPE_BY_FIELD_TYPE,
} from './custom-field-column.util';

describe('buildCustomColumnName', () => {
  it('gera um nome com prefixo custom_ a partir do nome de exibição', () => {
    expect(buildCustomColumnName('Número do crachá', [])).toBe('custom_numero_do_cracha');
  });

  it('remove caracteres especiais e colapsa underscores repetidos', () => {
    expect(buildCustomColumnName('Segmento (VIP)!!', [])).toBe('custom_segmento_vip');
  });

  it('acrescenta um sufixo numérico em caso de colisão', () => {
    expect(buildCustomColumnName('Segmento', ['custom_segmento'])).toBe('custom_segmento_2');
    expect(buildCustomColumnName('Segmento', ['custom_segmento', 'custom_segmento_2'])).toBe('custom_segmento_3');
  });

  it('nunca gera uma string vazia mesmo com nome de exibição só de símbolos', () => {
    expect(buildCustomColumnName('!!!', [])).toBe('custom_campo');
  });
});

describe('assertValidCustomColumnName', () => {
  it('aceita um nome bem formado', () => {
    expect(() => assertValidCustomColumnName('custom_segmento')).not.toThrow();
  });

  it('rejeita um nome sem o prefixo custom_', () => {
    expect(() => assertValidCustomColumnName('segmento')).toThrow();
  });

  it('rejeita uma tentativa de injeção via nome de coluna', () => {
    expect(() => assertValidCustomColumnName('custom_x"; DROP TABLE "Client";--')).toThrow();
  });

  it('rejeita letra maiúscula', () => {
    expect(() => assertValidCustomColumnName('custom_Segmento')).toThrow();
  });
});

describe('POSTGRES_TYPE_BY_FIELD_TYPE', () => {
  it('cobre todo valor do enum CustomFieldType', () => {
    for (const type of Object.values(CustomFieldType)) {
      expect(POSTGRES_TYPE_BY_FIELD_TYPE[type]).toBeDefined();
    }
  });

  it('mapeia CURRENCY para NUMERIC(14,2) e MULTI_SELECT para TEXT[]', () => {
    expect(POSTGRES_TYPE_BY_FIELD_TYPE[CustomFieldType.CURRENCY]).toBe('NUMERIC(14,2)');
    expect(POSTGRES_TYPE_BY_FIELD_TYPE[CustomFieldType.MULTI_SELECT]).toBe('TEXT[]');
  });
});
