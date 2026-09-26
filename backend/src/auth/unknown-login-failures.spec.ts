import { ForbiddenException } from '@nestjs/common';
import { accountLockedError } from './account-lock.util';
import { UnknownLoginFailureTracker } from './unknown-login-failures';

describe('UnknownLoginFailureTracker', () => {
  const MIN = 60_000;
  let now: number;
  let tracker: UnknownLoginFailureTracker;

  beforeEach(() => {
    now = 1_000_000_000_000;
    tracker = new UnknownLoginFailureTracker(() => now);
  });

  const fail = (email: string, times: number) => {
    for (let i = 0; i < times; i++) tracker.recordFailure(email);
  };

  it('4 falhas não travam; a 5ª trava por 15 minutos', () => {
    fail('x@teste.com', 4);
    expect(() => tracker.assertNotLocked('x@teste.com')).not.toThrow();
    tracker.recordFailure('x@teste.com');

    const err = (() => {
      try {
        tracker.assertNotLocked('x@teste.com');
      } catch (e) {
        return e as ForbiddenException;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err!.getResponse()).toEqual(accountLockedError(900).getResponse());
  });

  // Q5: a chave tem a MESMA semântica da busca da conta real (findUnique por igualdade exata, sem
  // transform no LoginDto) — normalizar aqui deixaria variantes de caixa distinguirem conta real de
  // e-mail inexistente.
  it('a chave é o e-mail exato (sem minúsculas nem trim — igual à busca da conta real)', () => {
    fail('Vitima@Teste.COM', 5);
    expect(() => tracker.assertNotLocked('Vitima@Teste.COM')).toThrow(ForbiddenException);
    expect(() => tracker.assertNotLocked('vitima@teste.com')).not.toThrow();
    expect(() => tracker.assertNotLocked(' Vitima@Teste.COM ')).not.toThrow();
  });

  it('retryAfterSeconds diminui com o tempo e a trava expira sozinha depois de 15 minutos', () => {
    fail('x@teste.com', 5);
    now += 10 * MIN;
    expect(() => tracker.assertNotLocked('x@teste.com')).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ retryAfterSeconds: 300 }) }),
    );
    now += 5 * MIN;
    expect(() => tracker.assertNotLocked('x@teste.com')).not.toThrow();
    // Depois de expirar, a contagem recomeça do zero.
    fail('x@teste.com', 4);
    expect(() => tracker.assertNotLocked('x@teste.com')).not.toThrow();
  });

  it('falhas espalhadas por mais de 15 minutos não somam (janela conta a partir da 1ª falha)', () => {
    fail('x@teste.com', 4);
    now += 15 * MIN + 1;
    tracker.recordFailure('x@teste.com');
    expect(() => tracker.assertNotLocked('x@teste.com')).not.toThrow();
    fail('x@teste.com', 3);
    expect(() => tracker.assertNotLocked('x@teste.com')).not.toThrow();
    tracker.recordFailure('x@teste.com');
    expect(() => tracker.assertNotLocked('x@teste.com')).toThrow(ForbiddenException);
  });

  it('e-mails diferentes não se misturam', () => {
    fail('a@teste.com', 5);
    expect(() => tracker.assertNotLocked('b@teste.com')).not.toThrow();
  });

  it('entradas vencidas são removidas (o mapa não guarda lixo)', () => {
    fail('a@teste.com', 1);
    fail('b@teste.com', 5);
    expect(tracker.size).toBe(2);
    now += 31 * MIN;
    tracker.prune();
    expect(tracker.size).toBe(0);
  });

  it('teto de tamanho: acima do limite, as entradas mais antigas são descartadas', () => {
    const small = new UnknownLoginFailureTracker(() => now, 3);
    small.recordFailure('a@teste.com');
    small.recordFailure('b@teste.com');
    small.recordFailure('c@teste.com');
    small.recordFailure('d@teste.com');
    expect(small.size).toBe(3);
    // 'a' foi o mais antigo — descartado; 'd' está lá.
    for (let i = 0; i < 4; i++) small.recordFailure('d@teste.com');
    expect(() => small.assertNotLocked('d@teste.com')).toThrow(ForbiddenException);
    expect(small.size).toBeLessThanOrEqual(3);
  });
});
