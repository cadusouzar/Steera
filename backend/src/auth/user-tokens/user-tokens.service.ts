import { BadRequestException, Injectable } from '@nestjs/common';
import { UserTokenType } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';

export const TOKEN_TTL_MS: Record<UserTokenType, number> = {
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
  INVITE: 72 * 60 * 60 * 1000,
  PASSWORD_RESET: 30 * 60 * 1000,
};

// Cooldown dos e-mails pedidos pela PRÓPRIA pessoa (esqueci minha senha, reenviar confirmação, aviso
// de conta travada): e-mail é pago por mensagem, então com um link do mesmo tipo emitido há menos que
// isso — e ainda válido — nada novo é emitido nem enviado; o link anterior continua valendo. Ações de
// admin (criar/reenviar convite, redefinir senha de outro login) não passam por aqui.
export const SELF_SERVICE_EMAIL_COOLDOWN_MS = 5 * 60 * 1000;

// Exportada: AuthService reaproveita o MESMO texto quando um token válido cai num estado que não
// pode usá-lo (reset de um INVITED, aceite de convite de um login que não é mais INVITED).
export const INVALID_OR_EXPIRED_MESSAGE = 'Link inválido ou expirado. Peça um novo.';

/**
 * Issues and consumes single-use, hashed tokens (e-mail verification, invite,
 * password reset) stored in the central `UserToken` table.
 *
 * `UserToken` is a central table without RLS, but this service is called both
 * from public routes (no tenant context active yet — e.g. accept-invite,
 * reset-password) and from authenticated routes (a tenant context IS active
 * — e.g. issuing an invite for a newly created employee login). Every
 * operation is wrapped in `runAsSystem(...)` so behavior never depends on
 * whichever context (or lack thereof) happens to be active in the caller —
 * same reasoning as `AuthService`'s own `runAsSystem` call sites. `runAsSystem`
 * is safe to nest inside an already-active tenant context: it just replaces
 * the AsyncLocalStorage store for the duration of `fn`, restoring the outer
 * store once `fn` resolves (see `tenant-context.ts`), so it never leaks the
 * bypass to code running after this service returns.
 */
@Injectable()
export class UserTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, type: UserTokenType): Promise<string> {
    return runAsSystem(async () => {
      // Invalidate any pending (unused) token of the same user+type before
      // issuing a new one — only the most recently issued link should work.
      await this.prisma.userToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      });

      const raw = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(raw).digest('hex');
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[type]);

      await this.prisma.userToken.create({
        data: { userId, type, tokenHash, expiresAt },
      });

      return raw;
    });
  }

  // true se há um token do mesmo usuário+tipo emitido há menos de `withinMs`, ainda não usado e não
  // expirado — ver SELF_SERVICE_EMAIL_COOLDOWN_MS. Não é atômico com issue() (duas requisições
  // simultâneas podem ambas ver `false`); o objetivo é cortar reenvios repetidos, não ser uma trava.
  async hasRecentPending(userId: string, type: UserTokenType, withinMs: number): Promise<boolean> {
    return runAsSystem(async () => {
      const now = Date.now();
      const found = await this.prisma.userToken.findFirst({
        where: {
          userId,
          type,
          usedAt: null,
          expiresAt: { gt: new Date(now) },
          createdAt: { gt: new Date(now - withinMs) },
        },
        select: { id: true },
      });
      return found !== null;
    });
  }

  async consume(rawToken: string, type: UserTokenType): Promise<string> {
    return runAsSystem(async () => {
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const found = await this.prisma.userToken.findUnique({ where: { tokenHash } });

      if (!found || found.type !== type) {
        throw new BadRequestException(INVALID_OR_EXPIRED_MESSAGE);
      }

      // Atomic claim: only succeeds if the token was still unused and not
      // expired at the moment of the update, closing the race between two
      // concurrent consumers of the same token.
      const { count } = await this.prisma.userToken.updateMany({
        where: { id: found.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });

      if (count === 0) {
        throw new BadRequestException(INVALID_OR_EXPIRED_MESSAGE);
      }

      return found.userId;
    });
  }
}
