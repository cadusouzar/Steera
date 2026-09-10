import { BadRequestException } from '@nestjs/common';
import { maskCpf, normalizeCpf } from './cpf.util';

describe('cpf.util', () => {
  it('strips formatting characters and keeps 11 digits', () => {
    expect(normalizeCpf('111.222.333-44')).toBe('11122233344');
  });

  it('rejects a CPF with the wrong number of digits', () => {
    expect(() => normalizeCpf('123')).toThrow(BadRequestException);
  });

  it('masks the middle digits, keeping the first 3 and last 2 visible', () => {
    expect(maskCpf('11122233344')).toBe('111.***.**44');
  });
});
