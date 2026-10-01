import { createHash } from 'crypto';
import { INVALID_OR_EXPIRED_MESSAGE, SELF_SERVICE_EMAIL_COOLDOWN_MS, UserTokensService } from './user-tokens.service';

describe('UserTokensService', () => {
  const prisma = {
    userToken: { updateMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  } as any;
  const service = new UserTokensService(prisma);
  beforeEach(() => jest.resetAllMocks());

  it('issue invalidates pending tokens of the same type and stores only the hash', async () => {
    prisma.userToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.userToken.create.mockResolvedValue({});
    const raw = await service.issue('u1', 'PASSWORD_RESET');
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(prisma.userToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    const data = prisma.userToken.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(data.tokenHash).not.toBe(raw);
    expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60_000);
  });

  describe('hasRecentPending (cooldown de e-mails pedidos pela própria pessoa)', () => {
    it('procura um token do mesmo usuário+tipo, não usado, não expirado e emitido dentro da janela', async () => {
      prisma.userToken.findFirst.mockResolvedValue({ id: 't1' });
      const before = Date.now();

      await expect(service.hasRecentPending('u1', 'PASSWORD_RESET', 5 * 60_000)).resolves.toBe(true);

      const { where } = prisma.userToken.findFirst.mock.calls[0][0];
      expect(where.userId).toBe('u1');
      expect(where.type).toBe('PASSWORD_RESET');
      expect(where.usedAt).toBeNull();
      expect(where.expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
      expect(where.expiresAt.gt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(where.createdAt.gt.getTime()).toBeGreaterThanOrEqual(before - 5 * 60_000);
      expect(where.createdAt.gt.getTime()).toBeLessThanOrEqual(Date.now() - 5 * 60_000);
    });

    it('nenhum token recente pendente → false', async () => {
      prisma.userToken.findFirst.mockResolvedValue(null);
      await expect(service.hasRecentPending('u1', 'INVITE', 5 * 60_000)).resolves.toBe(false);
    });

    it('o cooldown padrão é de 5 minutos', () => {
      expect(SELF_SERVICE_EMAIL_COOLDOWN_MS).toBe(5 * 60_000);
    });
  });

  describe('peek (confere o token sem gastá-lo)', () => {
    const future = new Date(Date.now() + 60_000);

    it('token válido, não usado e não expirado → devolve o userId sem escrever nada', async () => {
      prisma.userToken.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', type: 'INVITE', usedAt: null, expiresAt: future });
      await expect(service.peek('raw', 'INVITE')).resolves.toBe('u1');
      expect(prisma.userToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: createHash('sha256').update('raw').digest('hex') },
      });
      expect(prisma.userToken.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['inexistente', null],
      ['de outro tipo', { id: 't1', userId: 'u1', type: 'PASSWORD_RESET', usedAt: null, expiresAt: future }],
      ['já usado', { id: 't1', userId: 'u1', type: 'INVITE', usedAt: new Date(), expiresAt: future }],
      ['expirado', { id: 't1', userId: 'u1', type: 'INVITE', usedAt: null, expiresAt: new Date(Date.now() - 1) }],
    ])('token %s → mesma mensagem genérica', async (_label, found) => {
      prisma.userToken.findUnique.mockResolvedValue(found);
      await expect(service.peek('raw', 'INVITE')).rejects.toThrow(INVALID_OR_EXPIRED_MESSAGE);
    });
  });

  it('consume marks the token used atomically and returns the userId', async () => {
    prisma.userToken.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', type: 'INVITE' });
    prisma.userToken.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.consume('raw', 'INVITE')).resolves.toBe('u1');
    expect(prisma.userToken.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });
  });

  it.each([
    ['unknown token', null, { count: 1 }],
    ['wrong type', { id: 't1', userId: 'u1', type: 'PASSWORD_RESET' }, { count: 1 }],
    ['expired or already used (lost the race)', { id: 't1', userId: 'u1', type: 'INVITE' }, { count: 0 }],
  ])('consume rejects %s', async (_label, found, updated) => {
    prisma.userToken.findUnique.mockResolvedValue(found);
    prisma.userToken.updateMany.mockResolvedValue(updated);
    await expect(service.consume('raw', 'INVITE')).rejects.toThrow('Link inválido ou expirado. Peça um novo.');
  });
});

// Fix round 1 (Task 7): mensagem única exportada — AuthService (reset de INVITED, aceite de convite
// de login não-INVITED) reaproveita esta constante em vez de duplicar o texto.
describe('INVALID_OR_EXPIRED_MESSAGE', () => {
  it('é a mensagem genérica de link inválido/expirado', () => {
    expect(INVALID_OR_EXPIRED_MESSAGE).toBe('Link inválido ou expirado. Peça um novo.');
  });
});
