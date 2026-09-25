import { BadRequestException } from '@nestjs/common';
import { maskDocument, normalizeDocument } from './document.util';

describe('normalizeDocument', () => {
  it('PJ: aceita CNPJ numérico e alfanumérico com máscara', () => {
    expect(normalizeDocument('PJ', '11.222.333/0001-81')).toBe('11222333000181');
    expect(normalizeDocument('PJ', '12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });
  it('PF: aceita CPF com máscara', () => {
    expect(normalizeDocument('PF', '529.982.247-25')).toBe('52998224725');
  });
  it('rejeita CPF num cadastro PJ e CNPJ num PF', () => {
    expect(() => normalizeDocument('PJ', '529.982.247-25')).toThrow(BadRequestException);
    expect(() => normalizeDocument('PF', '11.222.333/0001-81')).toThrow(BadRequestException);
  });
});

describe('maskDocument', () => {
  it('mascara por tipo e devolve null sem documento', () => {
    expect(maskDocument('PJ', '11222333000181')).toBe('11.222.***/0001-**');
    expect(maskDocument('PF', '52998224725')).toBe('529.***.**25');
    expect(maskDocument(null, null)).toBeNull();
  });
});
