import { BadRequestException } from '@nestjs/common';
import { maskCnpj, normalizeCnpj } from '../common/cnpj.util';
import { maskCpf, normalizeCpf } from '../common/cpf.util';

export type PersonType = 'PJ' | 'PF';

// Mensagem própria (não a de normalizeCnpj/normalizeCpf) quando o formato é do OUTRO tipo — o erro
// mais comum é o usuário deixar o seletor em PJ e digitar o CPF.
export function normalizeDocument(personType: PersonType, raw: string): string {
  const compact = raw.replace(/[^0-9A-Za-z]/g, '');
  if (personType === 'PJ') {
    if (compact.length === 11) throw new BadRequestException('Informe um CNPJ (ou troque o tipo de conta para Pessoa Física)');
    return normalizeCnpj(raw);
  }
  if (compact.length === 14) throw new BadRequestException('Informe um CPF (ou troque o tipo de conta para Pessoa Jurídica)');
  return normalizeCpf(raw);
}

export function maskDocument(personType: PersonType | null, document: string | null): string | null {
  if (!personType || !document) return null;
  return personType === 'PJ' ? maskCnpj(document) : maskCpf(document);
}
