import { EmailVerifiedGuard } from './email-verified.guard';
import { ALLOW_UNVERIFIED_EMAIL_KEY } from '../decorators/allow-unverified-email.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('EmailVerifiedGuard', () => {
  const prisma = { user: { findUnique: jest.fn() } } as any;
  const reflector = { getAllAndOverride: jest.fn() } as any;
  const guard = new EmailVerifiedGuard(reflector, prisma);
  const ctx = (user: any) => ({
    getHandler: () => null, getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;
  beforeEach(() => jest.resetAllMocks());

  it('passes public/allowlisted routes without touching the DB', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(ctx({ emailVerificationPending: true }))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('passes a route marked only with @AllowUnverifiedEmail() (not public) for a pending login', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => key === ALLOW_UNVERIFIED_EMAIL_KEY);
    await expect(guard.canActivate(ctx({ userId: 'u1', emailVerificationPending: true }))).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [null, null]);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('passes verified logins without touching the DB', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    await expect(guard.canActivate(ctx({ userId: 'u1', emailVerificationPending: false }))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('re-checks the DB when the token says pending and lets through once confirmed', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: new Date(), emailVerificationRequired: true });
    await expect(guard.canActivate(ctx({ userId: 'u1', emailVerificationPending: true }))).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { emailVerifiedAt: true, emailVerificationRequired: true },
    });
  });

  it('blocks with EMAIL_NOT_VERIFIED while still unconfirmed', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    prisma.user.findUnique.mockResolvedValue({ emailVerifiedAt: null, emailVerificationRequired: true });
    await expect(guard.canActivate(ctx({ userId: 'u1', emailVerificationPending: true }))).rejects.toMatchObject({
      response: { code: 'EMAIL_NOT_VERIFIED', message: 'Confirme seu e-mail para acessar o sistema.' },
    });
  });

  it('blocks when the user row no longer exists', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(ctx({ userId: 'u1', emailVerificationPending: true }))).rejects.toMatchObject({
      response: { code: 'EMAIL_NOT_VERIFIED' },
    });
  });
});
