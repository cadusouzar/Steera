import { BadRequestException } from '@nestjs/common';
import { normalizePhone } from './phone.util';

describe('phone.util', () => {
  it('strips formatting and keeps a valid 11-digit mobile number', () => {
    expect(normalizePhone('(11) 91234-5678')).toBe('11912345678');
  });

  it('strips formatting and keeps a valid 10-digit landline number', () => {
    expect(normalizePhone('(11) 1234-5678')).toBe('1112345678');
  });

  it('accepts a bare digit string with no formatting', () => {
    expect(normalizePhone('11912345678')).toBe('11912345678');
  });

  it('rejects too few digits', () => {
    expect(() => normalizePhone('123')).toThrow(BadRequestException);
    expect(() => normalizePhone('123')).toThrow('phone deve conter 10 ou 11 dígitos (DDD + número)');
  });

  it('rejects too many digits', () => {
    expect(() => normalizePhone('119123456789')).toThrow(BadRequestException);
  });
});
