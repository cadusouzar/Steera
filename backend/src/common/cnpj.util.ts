import { BadRequestException } from '@nestjs/common';

const REPEATED_DIGIT_CNPJS = new Set(Array.from({ length: 10 }, (_, d) => String(d).repeat(14)));

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * weights[i];
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

// Mesmo padrão de backend/src/common/cpf.util.ts — dois dígitos verificadores, pesos fixos. A
// sequência "00000000000000" (e só ela, entre as 10 sequências de dígito repetido) passa pela
// fórmula pura por coincidência; excluída explicitamente, igual ao CPF.
export function isValidCnpjChecksum(digits: string): boolean {
  if (digits.length !== 14 || REPEATED_DIGIT_CNPJS.has(digits)) return false;
  const firstCheck = checkDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondCheck = checkDigit(digits.slice(0, 12) + firstCheck, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits[12] === String(firstCheck) && digits[13] === String(secondCheck);
}

export function normalizeCnpj(rawCnpj: string): string {
  const digits = rawCnpj.replace(/\D/g, '');
  if (digits.length !== 14) {
    throw new BadRequestException('cnpj deve conter 14 dígitos');
  }
  if (!isValidCnpjChecksum(digits)) {
    throw new BadRequestException('CNPJ inválido');
  }
  return digits;
}
