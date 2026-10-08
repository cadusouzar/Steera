import { LegalAcceptanceGuard } from './legal-acceptance.guard';
import { ALLOW_PENDING_LEGAL_ACCEPTANCE_KEY } from '../decorators/allow-pending-legal-acceptance.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('LegalAcceptanceGuard', () => {
  const legal = { isPending: jest.fn() } as any;
  const reflector = { getAllAndOverride: jest.fn() } as any;
  const guard = new LegalAcceptanceGuard(reflector, legal);
  const ctx = (user: any) => ({
    getHandler: () => null, getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;
  beforeEach(() => jest.resetAllMocks());

  it('passa rotas @Public() sem consultar o banco', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => key === IS_PUBLIC_KEY);
    await expect(guard.canActivate(ctx({ userId: 'u1', legalAcceptancePending: true }))).resolves.toBe(true);
    expect(legal.isPending).not.toHaveBeenCalled();
  });

  it('passa rotas @AllowPendingLegalAcceptance() sem consultar o banco', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => key === ALLOW_PENDING_LEGAL_ACCEPTANCE_KEY);
    await expect(guard.canActivate(ctx({ userId: 'u1', legalAcceptancePending: true }))).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [null, null]);
    expect(legal.isPending).not.toHaveBeenCalled();
  });

  it('sem claim pendente passa sem consultar o banco', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    await expect(guard.canActivate(ctx({ userId: 'u1', legalAcceptancePending: false }))).resolves.toBe(true);
    expect(legal.isPending).not.toHaveBeenCalled();
  });

  it('claim pendente + banco já aceito → passa (aceitar libera na hora)', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    legal.isPending.mockResolvedValue(false);
    await expect(guard.canActivate(ctx({ userId: 'u1', legalAcceptancePending: true }))).resolves.toBe(true);
    expect(legal.isPending).toHaveBeenCalledWith('u1');
  });

  it('claim pendente + banco ainda pendente → 403 LEGAL_ACCEPTANCE_REQUIRED', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    legal.isPending.mockResolvedValue(true);
    await expect(guard.canActivate(ctx({ userId: 'u1', legalAcceptancePending: true }))).rejects.toMatchObject({
      response: {
        statusCode: 403,
        code: 'LEGAL_ACCEPTANCE_REQUIRED',
        message: 'Aceite os Termos de uso e a Política de Privacidade para continuar.',
      },
    });
  });
});
