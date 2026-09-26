import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

// Hash "de mentira" do processo (fix final de "Acesso e sessões"): AuthService.login confere a senha
// contra ele quando não há hash real a conferir (e-mail sem conta, login INVITED) — assim a latência
// dessas respostas bate com a de uma conta real (um argon2.verify inteiro) e não denuncia se o
// e-mail existe. Calculado uma única vez, sob demanda, a partir de um valor aleatório que ninguém
// conhece. Chama argon2.hash direto (não hashPassword) pra nunca herdar um mock de teste dela.
let dummyHashPromise: Promise<string> | null = null;
export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash(randomBytes(32).toString('hex')).catch((err: unknown) => {
      dummyHashPromise = null;
      throw err;
    });
  }
  return dummyHashPromise;
}
