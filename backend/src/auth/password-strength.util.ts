import { BadRequestException } from '@nestjs/common';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnPtBr from '@zxcvbn-ts/language-pt-br';

// Senha forte = nota do zxcvbn >= 3 (escala 0-4). Mesma regra de src/lib/passwordStrength.ts no
// frontend (duplicada de propósito, frontend não importa código do backend) — aqui é a fronteira de
// verdade, chamada por todo fluxo que DEFINE uma senha (register, changePassword, resetPassword,
// acceptInvite). Login nunca chama: senhas antigas mais fracas continuam entrando normalmente.
export const MIN_PASSWORD_SCORE = 3;

// Duas traduções da biblioteca saem truncadas/estranhas em pt-BR — sobrescritas aqui (e iguais no
// frontend).
const translations = {
  ...zxcvbnPtBr.translations,
  warnings: {
    ...zxcvbnPtBr.translations.warnings,
    userInputs: 'Não use dados pessoais ou da empresa (nome, e-mail) na senha.',
  },
  suggestions: {
    ...zxcvbnPtBr.translations.suggestions,
    capitalization: 'Use letras maiúsculas em outras posições, não só na primeira.',
  },
};

// Construído uma vez por processo (os dicionários são grandes).
const zxcvbn = new ZxcvbnFactory({
  translations,
  graphs: zxcvbnCommon.adjacencyGraphs,
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnPtBr.dictionary },
  useLevenshteinDistance: true,
});

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Dados da pessoa/empresa viram "palavras proibidas" pro zxcvbn: o valor inteiro, cada pedaço
// (separado por espaço/ponto/@/hífen etc.) e a versão colada sem espaços ("padariacentral") — sem
// isso "padariacentral2026" passaria como forte.
export function buildPasswordUserInputs(values: Array<string | null | undefined>): string[] {
  const inputs = new Set<string>();
  for (const raw of values) {
    const value = stripAccents((raw ?? '').trim().toLowerCase());
    if (!value) continue;
    inputs.add(value);
    const parts = value.split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
    parts.forEach((p) => inputs.add(p));
    if (parts.length > 1) inputs.add(parts.join(''));
  }
  return [...inputs];
}

export function assertStrongPassword(password: string, userInputs: string[]): void {
  const result = zxcvbn.check(password, userInputs);
  if (result.score >= MIN_PASSWORD_SCORE) return;
  const hint = result.feedback.warning ?? result.feedback.suggestions[0] ?? 'Use uma senha mais longa e menos previsível.';
  throw new BadRequestException(`Senha fraca. ${hint}`);
}
