import { BadRequestException } from '@nestjs/common';

const REPEATED_DIGIT_CPFS = new Set(Array.from({ length: 10 }, (_, d) => String(d).repeat(11)));

function checkDigit(base: string, firstWeight: number): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * (firstWeight - i);
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

// As 11 sequências de dígito repetido ("00000000000".."99999999999") produzem um checksum
// matematicamente "válido" pela fórmula pura — um erro conhecido de quem implementa só a fórmula
// sem essa exclusão explícita. Nenhuma delas é um CPF real.
export function isValidCpfChecksum(digits: string): boolean {
  if (digits.length !== 11 || REPEATED_DIGIT_CPFS.has(digits)) return false;
  const firstCheck = checkDigit(digits.slice(0, 9), 10);
  const secondCheck = checkDigit(digits.slice(0, 9) + firstCheck, 11);
  return digits[9] === String(firstCheck) && digits[10] === String(secondCheck);
}

export function normalizeCpf(rawCpf: string): string {
  const digits = rawCpf.replace(/\D/g, '');
  if (digits.length !== 11) {
    throw new BadRequestException('cpf deve conter 11 dígitos');
  }
  if (!isValidCpfChecksum(digits)) {
    throw new BadRequestException('CPF inválido');
  }
  return digits;
}

// LGPD: nunca expor o CPF completo em listagens — mantém os 3 primeiros e os
// 2 últimos dígitos visíveis, mascara o resto.
export function maskCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.***.**${cpf.slice(-2)}`;
}
