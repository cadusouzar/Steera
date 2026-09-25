import { randomInt } from 'crypto';

function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (base.charCodeAt(i) - 48) * weights[i];
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => String(randomInt(10))).join('');
}

// Documento é @unique — cada cadastro de teste precisa de um CNPJ/CPF novo e válido.
export function randomValidCnpj(): string {
  const base = randomDigits(12);
  const d1 = checkDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

export function randomValidCpf(): string {
  const base = randomDigits(9);
  const d1 = checkDigit(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(base + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

// Corpo válido de POST /auth/register (PJ). `companyName` vira nome fantasia E razão social, pra
// manter legível o que cada suíte antiga já passava; `overrides` sobrescreve qualquer campo.
export function buildRegisterBody(opts: {
  email: string;
  password: string;
  companyName?: string;
  overrides?: Record<string, unknown>;
}): Record<string, unknown> {
  const companyName = opts.companyName ?? 'Empresa de Teste';
  return {
    personType: 'PJ',
    document: randomValidCnpj(),
    legalName: companyName,
    tradeName: companyName,
    phone: '11987654321',
    zipCode: '01310100',
    street: 'Avenida Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    name: 'Responsável de Teste',
    email: opts.email,
    password: opts.password,
    ...opts.overrides,
  };
}
