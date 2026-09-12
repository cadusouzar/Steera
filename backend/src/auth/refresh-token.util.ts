import { randomBytes, createHash } from 'crypto';

// Valor aleatório de alta entropia (256 bits) — nunca persistido em texto
// puro, só o hash (sha256 é suficiente aqui: ao contrário de senha, que tem
// baixa entropia e precisa de argon2/bcrypt pra resistir a força bruta, este
// valor já É a entropia, hash rápido não enfraquece nada).
export function generateRefreshTokenValue(): string {
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
