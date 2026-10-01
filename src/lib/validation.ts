// Espelha as mesmas regras do backend (backend/src/common/cpf.util.ts, cnpj.util.ts, phone.util.ts,
// e os tetos de @MaxLength/@Max dos DTOs) — duplicado aqui de propósito, já que o frontend não pode
// importar código do backend. Mostrar o erro ANTES de submeter poupa uma ida e volta ao servidor,
// mas o backend continua sendo a fronteira de verdade — este arquivo nunca é a única validação.

const REPEATED_DIGIT_CPFS = new Set(Array.from({ length: 10 }, (_, d) => String(d).repeat(11)));
const REPEATED_DIGIT_CNPJS = new Set(Array.from({ length: 10 }, (_, d) => String(d).repeat(14)));
const CNPJ_SHAPE = /^[0-9A-Z]{12}[0-9]{2}$/;

// Valor do caractere = ASCII − 48 (regra oficial do CNPJ alfanumérico; pra dígitos é o próprio
// dígito, então CPF e CNPJ numérico continuam calculando igual a antes).
function checkDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (base.charCodeAt(i) - 48) * weights[i];
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function stripCnpj(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export function isValidCpf(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 11 || REPEATED_DIGIT_CPFS.has(digits)) return false;
  const weights1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = checkDigit(digits.slice(0, 9), weights1);
  const weights2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
  const d2 = checkDigit(digits.slice(0, 9) + d1, weights2);
  return digits[9] === String(d1) && digits[10] === String(d2);
}

// CNPJ alfanumérico (emitido pela Receita desde julho/2026) aceito — espelha backend/src/common/cnpj.util.ts.
export function isValidCnpj(value: string): boolean {
  const v = stripCnpj(value);
  if (!CNPJ_SHAPE.test(v) || REPEATED_DIGIT_CNPJS.has(v)) return false;
  const d1 = checkDigit(v.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(v.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return v[12] === String(d1) && v[13] === String(d2);
}

// Só DDD (2 dígitos) + 8 (fixo) ou 9 (celular) dígitos — sem checar a lista exata de DDDs válidos,
// que muda com o tempo e não vale a rigidez (mesma decisão do backend, phone.util.ts).
export function isValidPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}

// Máscaras de digitação — aplicadas a cada `onChange`, incrementais (funcionam corretamente com
// apagar/colar no meio do texto porque sempre recomputam a partir dos dígitos crus).
export function formatCpfInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length > 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  if (digits.length > 6) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  if (digits.length > 3) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  return digits;
}

export function formatCnpjInput(raw: string): string {
  const v = stripCnpj(raw).slice(0, 14);
  if (v.length > 12) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  if (v.length > 8) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8)}`;
  if (v.length > 5) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5)}`;
  if (v.length > 2) return `${v.slice(0, 2)}.${v.slice(2)}`;
  return v;
}

export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length > 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length > 6) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length > 2) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length > 0) return `(${digits}`;
  return digits;
}

export function formatCepInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

// Mesma lista de backend/src/auth/dto/register.dto.ts (BRAZILIAN_STATES).
export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PR', 'PB', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

// Tetos espelhando os DTOs do backend (ver docs/superpowers/specs/2026-09-17-validation-and-error-
// consistency-design.md) — generosos de propósito, só pra pegar erro de digitação.
export const NAME_MAX_LENGTH = 255;
export const TEXT_MAX_LENGTH = 2000;
export const MONEY_MAX_VALUE = 100_000_000;
export const DAYS_MAX_VALUE = 365;
export const DAILY_MINUTES_MAX = 1440;
export const WEEKLY_MINUTES_MAX = 10080;

// Classe de borda de um input — `FormField.tsx` só cuida do rótulo/mensagem embaixo, cada input
// continua dono do próprio `className` (tamanhos/paddings variam entre telas), então isto só troca
// a cor da borda/anel de foco quando há erro.
export function inputBorderClass(hasError: boolean): string {
  return hasError
    ? 'border-danger/70 focus:ring-danger/30'
    : 'border-border focus:ring-foreground/20';
}
