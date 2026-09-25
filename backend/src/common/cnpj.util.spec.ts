import { BadRequestException } from '@nestjs/common';
import { isValidCnpjChecksum, maskCnpj, normalizeCnpj, stripCnpj } from './cnpj.util';

describe('cnpj.util', () => {
  describe('normalizeCnpj', () => {
    it('strips formatting characters and keeps 14 digits for a real, valid CNPJ', () => {
      expect(normalizeCnpj('11.222.333/0001-81')).toBe('11222333000181');
    });

    it('rejects a CNPJ with the wrong number of digits', () => {
      expect(() => normalizeCnpj('123')).toThrow(BadRequestException);
    });

    it('rejects 14 digits that fail the checksum', () => {
      expect(() => normalizeCnpj('11.222.333/0001-82')).toThrow('CNPJ inválido');
    });

    it('rejects every all-same-digit sequence, even though the raw formula would accept some of them', () => {
      for (let d = 0; d <= 9; d++) {
        expect(() => normalizeCnpj(String(d).repeat(14))).toThrow('CNPJ inválido');
      }
    });
  });

  describe('isValidCnpjChecksum', () => {
    it('accepts a real, valid CNPJ', () => {
      expect(isValidCnpjChecksum('11222333000181')).toBe(true);
    });

    it('rejects a wrong check digit', () => {
      expect(isValidCnpjChecksum('11222333000182')).toBe(false);
    });

    it('rejects the all-zeros sequence despite a mathematically matching checksum', () => {
      expect(isValidCnpjChecksum('00000000000000')).toBe(false);
    });
  });

  describe('CNPJ alfanumérico (IN RFB 2.229/2024, emitido desde julho/2026)', () => {
    it('aceita o exemplo oficial da Receita, com e sem máscara, em minúsculas também', () => {
      expect(isValidCnpjChecksum('12ABC34501DE35')).toBe(true);
      expect(normalizeCnpj('12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
      expect(normalizeCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    });

    it('rejeita dígito verificador errado num CNPJ alfanumérico', () => {
      expect(isValidCnpjChecksum('12ABC34501DE36')).toBe(false);
      expect(() => normalizeCnpj('12.ABC.345/01DE-36')).toThrow('CNPJ inválido');
    });

    it('rejeita letra nas duas posições de dígito verificador', () => {
      expect(isValidCnpjChecksum('12ABC34501DE3A')).toBe(false);
    });
  });

  describe('stripCnpj', () => {
    it('remove pontuação e deixa maiúsculo', () => {
      expect(stripCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    });
  });

  describe('maskCnpj', () => {
    it('mantém raiz parcial e filial, mascara o meio e os verificadores', () => {
      expect(maskCnpj('11222333000181')).toBe('11.222.***/0001-**');
      expect(maskCnpj('12ABC34501DE35')).toBe('12.ABC.***/01DE-**');
    });
  });
});
