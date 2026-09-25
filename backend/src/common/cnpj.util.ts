import { BadRequestException } from '@nestjs/common';

const REPEATED_DIGIT_CNPJS = new Set(Array.from({ length: 10 }, (_, d) => String(d).repeat(14)));
// CNPJ alfanumérico (IN RFB 2.229/2024, emitido desde julho/2026): os 12 primeiros caracteres
// podem ser [0-9A-Z]; os 2 dígitos verificadores continuam sempre numéricos. CNPJs antigos (só
// dígitos) continuam válidos pela mesma regra.
const CNPJ_SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;

// Valor de cada caractere no cálculo = código ASCII − 48 (regra oficial): '0'..'9' → 0..9 (igual
// ao algoritmo antigo), 'A' → 17, 'B' → 18, … 'Z' → 42.
function charValue(ch: string): number {
  return ch.charCodeAt(0) - 48;
}

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += charValue(base[i]) * weights[i];
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

// Remove máscara e normaliza pra maiúsculas — nunca valida nada sozinho.
export function stripCnpj(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

// Mesmo padrão de backend/src/common/cpf.util.ts — dois dígitos verificadores, pesos fixos. A
// sequência "00000000000000" (e só ela, entre as 10 sequências de dígito repetido) passa pela
// fórmula pura por coincidência; excluída explicitamente, igual ao CPF.
export function isValidCnpjChecksum(value: string): boolean {
  if (!CNPJ_SHAPE.test(value) || REPEATED_DIGIT_CNPJS.has(value)) return false;
  const firstCheck = checkDigit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondCheck = checkDigit(value.slice(0, 12) + firstCheck, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value[12] === String(firstCheck) && value[13] === String(secondCheck);
}

export function normalizeCnpj(rawCnpj: string): string {
  const value = stripCnpj(rawCnpj);
  if (value.length !== 14) {
    throw new BadRequestException('cnpj deve conter 14 caracteres');
  }
  if (!isValidCnpjChecksum(value)) {
    throw new BadRequestException('CNPJ inválido');
  }
  return value;
}

// LGPD: mesma ideia de maskCpf — mantém raiz parcial e filial, esconde o resto.
export function maskCnpj(cnpj: string): string {
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.***/${cnpj.slice(8, 12)}-**`;
}
