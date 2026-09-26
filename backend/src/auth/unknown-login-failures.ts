import { accountLockedError } from './account-lock.util';

export const UNKNOWN_EMAIL_MAX_FAILURES = 5;
export const UNKNOWN_EMAIL_WINDOW_MS = 15 * 60_000;
export const UNKNOWN_EMAIL_LOCK_MS = 15 * 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

interface FailureRecord {
  count: number;
  firstFailureAt: number;
  lockedUntil: number | null;
}

// Trava temporária para e-mail SEM conta ("Acesso e sessões", fix round 1, 26/09/2026). Espelha a
// trava de conta real (User.lockedUntil em AuthService.login) pra quem chuta senha não distinguir
// "conta real travada" de "e-mail inventado": 5 falhas → 5ª ainda 401, 6ª → o MESMO
// accountLockedError(...). Substitui o throttler "login-email" no login, que rodava ANTES do handler
// e por isso contava logins CERTOS também (6 logins legítimos em 15min → 403 sem nenhuma senha
// errada). Aqui só falha conta, porque só é chamado no caminho de falha.
//
// Em memória, por processo: some num restart (aceitável — é só o espelho anti-enumeração; e-mail
// inexistente não tem nada a proteger). Janela conta a partir da 1ª falha. Nunca cresce sem limite:
// entradas vencidas saem na hora em que são tocadas e numa varredura (prune) quando o mapa passa
// do teto; se ainda assim estiver cheio, descarta as mais antigas (Map guarda ordem de inserção e
// toda falha reinsere a chave no fim, então "mais antiga" = menos recentemente ativa).
// Sem @Injectable() de propósito (os parâmetros do construtor são só pra teste): o AuthModule
// provê uma instância única via useFactory.
export class UnknownLoginFailureTracker {
  private readonly records = new Map<string, FailureRecord>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
  ) {}

  get size(): number {
    return this.records.size;
  }

  // Lança accountLockedError (403 ACCOUNT_TEMPORARILY_LOCKED) enquanto o e-mail estiver travado.
  assertNotLocked(email: string): void {
    const key = normalize(email);
    const record = this.getLive(key);
    if (record?.lockedUntil) {
      throw accountLockedError(Math.ceil((record.lockedUntil - this.now()) / 1000));
    }
  }

  recordFailure(email: string): void {
    const key = normalize(email);
    const now = this.now();
    const current = this.getLive(key);
    const record: FailureRecord =
      current && !current.lockedUntil ? current : { count: 0, firstFailureAt: now, lockedUntil: null };
    record.count += 1;
    if (record.count >= UNKNOWN_EMAIL_MAX_FAILURES) {
      record.count = 0;
      record.lockedUntil = now + UNKNOWN_EMAIL_LOCK_MS;
    }
    this.records.delete(key);
    this.records.set(key, record);
    this.enforceCap();
  }

  // Remove toda entrada vencida (janela de falhas passou sem travar, ou trava já expirou).
  prune(): void {
    for (const [key, record] of this.records) {
      if (this.isExpired(record)) this.records.delete(key);
    }
  }

  private getLive(key: string): FailureRecord | undefined {
    const record = this.records.get(key);
    if (record && this.isExpired(record)) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }

  private isExpired(record: FailureRecord): boolean {
    const now = this.now();
    if (record.lockedUntil !== null) return record.lockedUntil <= now;
    return record.firstFailureAt + UNKNOWN_EMAIL_WINDOW_MS <= now;
  }

  private enforceCap(): void {
    if (this.records.size <= this.maxEntries) return;
    this.prune();
    while (this.records.size > this.maxEntries) {
      const oldest = this.records.keys().next().value as string;
      this.records.delete(oldest);
    }
  }
}

function normalize(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}
