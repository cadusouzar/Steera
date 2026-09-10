import { BadRequestException } from '@nestjs/common';

export function normalizeCpf(rawCpf: string): string {
  const digits = rawCpf.replace(/\D/g, '');
  if (digits.length !== 11) {
    throw new BadRequestException('cpf deve conter 11 dígitos');
  }
  return digits;
}

// LGPD: nunca expor o CPF completo em listagens — mantém os 3 primeiros e os
// 2 últimos dígitos visíveis, mascara o resto.
export function maskCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.***.**${cpf.slice(-2)}`;
}
