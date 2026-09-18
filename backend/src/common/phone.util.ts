import { BadRequestException } from '@nestjs/common';

// Mesmo padrão de backend/src/common/cpf.util.ts: normaliza removendo tudo que não é dígito, então
// valida a forma (DDD de 2 dígitos + 8 dígitos pra fixo, ou + 9 dígitos pra celular — sem checar a
// lista exata de DDDs válidos, que muda com o tempo e não vale a rigidez).
export function normalizePhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 11) {
    throw new BadRequestException('phone deve conter 10 ou 11 dígitos (DDD + número)');
  }
  return digits;
}
