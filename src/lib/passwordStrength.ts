// Medidor de força de senha (zxcvbn) — mesma regra de backend/src/auth/password-strength.util.ts,
// duplicada de propósito (frontend não importa código do backend). Aqui é só atalho de UX: o
// backend continua sendo a fronteira de verdade e recusa senha fraca com 400 "Senha fraca. ...".
//
// O zxcvbn + dicionários pesam algumas centenas de KB — carregados sob demanda (import dinâmico), só
// quando alguma tela de senha é aberta, pra não pesar no bundle do resto do app.
import type { ZxcvbnFactory } from '@zxcvbn-ts/core';

export const MIN_PASSWORD_SCORE = 3;

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  hint: string | null;
}

let factoryPromise: Promise<ZxcvbnFactory> | null = null;

function loadFactory(): Promise<ZxcvbnFactory> {
  if (!factoryPromise) {
    factoryPromise = Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-pt-br'),
    ])
      .then(([core, common, ptBr]) => {
        // Mesmas duas traduções sobrescritas do backend (as da biblioteca saem truncadas em pt-BR).
        const translations = {
          ...ptBr.translations,
          warnings: {
            ...ptBr.translations.warnings,
            userInputs: 'Não use dados pessoais ou da empresa (nome, e-mail) na senha.',
          },
          suggestions: {
            ...ptBr.translations.suggestions,
            capitalization: 'Use letras maiúsculas em outras posições, não só na primeira.',
          },
        };
        return new core.ZxcvbnFactory({
          translations,
          graphs: common.adjacencyGraphs,
          dictionary: { ...common.dictionary, ...ptBr.dictionary },
          useLevenshteinDistance: true,
        });
      })
      .catch((err: unknown) => {
        factoryPromise = null;
        throw err;
      });
  }
  return factoryPromise;
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Dados da pessoa/empresa como "palavras proibidas": valor inteiro, cada pedaço e a versão colada
// ("padariacentral") — igual ao backend.
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

export async function checkPasswordStrength(password: string, userInputs: string[]): Promise<PasswordStrength> {
  const zxcvbn = await loadFactory();
  const result = zxcvbn.check(password, userInputs);
  const hint = result.feedback.warning ?? result.feedback.suggestions[0] ?? null;
  return { score: result.score, hint };
}

// Erro de senha fraca devolvido pelo backend (ver assertStrongPassword) — as telas com link
// (redefinir senha, aceitar convite) tratam qualquer outro 400 como "link inválido", então precisam
// reconhecer este pra mostrar o erro no campo de senha em vez de descartar o link.
export function isWeakPasswordError(message: string): boolean {
  return message.startsWith('Senha fraca');
}
