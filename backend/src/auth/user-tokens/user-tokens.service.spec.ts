import { createHash } from 'crypto';
import { UserTokensService } from './user-tokens.service';

describe('UserTokensService', () => {
  const prisma = { userToken: { updateMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() } } as any;
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
