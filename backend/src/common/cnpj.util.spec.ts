import { BadRequestException } from '@nestjs/common';
import { isValidCnpjChecksum, normalizeCnpj } from './cnpj.util';

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
});
