import { BadRequestException } from '@nestjs/common';
import { isValidCpfChecksum, maskCpf, normalizeCpf } from './cpf.util';

describe('cpf.util', () => {
  describe('normalizeCpf', () => {
    it('strips formatting characters and keeps 11 digits for a real, valid CPF', () => {
      expect(normalizeCpf('111.444.777-35')).toBe('11144477735');
    });

    it('rejects a CPF with the wrong number of digits', () => {
      expect(() => normalizeCpf('123')).toThrow(BadRequestException);
    });

    it('rejects 11 digits that fail the checksum', () => {
      expect(() => normalizeCpf('111.222.333-44')).toThrow(BadRequestException);
      expect(() => normalizeCpf('111.222.333-44')).toThrow('CPF inválido');
    });

    it('rejects every all-same-digit sequence, even though the raw formula would accept them', () => {
      for (let d = 0; d <= 9; d++) {
        expect(() => normalizeCpf(String(d).repeat(11))).toThrow('CPF inválido');
      }
    });
  });

  describe('isValidCpfChecksum', () => {
    it('accepts a real, valid CPF', () => {
      expect(isValidCpfChecksum('11144477735')).toBe(true);
    });

    it('accepts a second real, valid CPF', () => {
      expect(isValidCpfChecksum('52998224725')).toBe(true);
    });

    it('rejects a wrong check digit', () => {
      expect(isValidCpfChecksum('11144477736')).toBe(false);
    });

    it('rejects a repeated-digit sequence despite a mathematically matching checksum', () => {
      expect(isValidCpfChecksum('11111111111')).toBe(false);
    });
  });

  it('masks the middle digits, keeping the first 3 and last 2 visible', () => {
    expect(maskCpf('11144477735')).toBe('111.***.**35');
  });
});
