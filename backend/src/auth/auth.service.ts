import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule as AppModuleEnum, Prisma } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { runAsSystem } from '../prisma/tenant-context';
import { runTenantInteractiveTransaction, runTenantTransaction } from '../prisma/tenant-rls.extension';
import { hashPassword, verifyPassword } from './password.util';
import { generateRefreshTokenValue, hashRefreshToken } from './refresh-token.util';

const ALL_MODULES: AppModuleEnum[] = ['DASHBOARD', 'CLIENTES', 'RH', 'COMERCIAL', 'OPERACOES', 'FINANCAS'];
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const REFRESH_COOKIE_NAME = 'rt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private signAccessToken(user: {
    id: string;
    companyId: string;
    role: string;
    modules: string[];
    mustChangePassword: boolean;
  }) {
    return this.jwt.sign(
      {
        sub: user.id,
        companyId: user.companyId,
        role: user.role,
        modules: user.modules,
        mustChangePassword: user.mustChangePassword,
      },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m', algorithm: 'HS256' },
    );
  }

  private async issueRefreshToken(userId: string, replaces?: string) {
    const value = generateRefreshTokenValue();
    const created = await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashRefreshToken(value), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });
    if (replaces) {
      await this.prisma.refreshToken.update({ where: { id: replaces }, data: { replacedByTokenId: created.id } });
    }
    return value;
  }

  private setRefreshCookie(res: Response, value: string) {
    res.cookie(REFRESH_COOKIE_NAME, value, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/auth',
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }

  async register(dto: { companyName: string; email: string; password: string }, res: Response) {
    const passwordHash = await hashPassword(dto.password);
    let user;
    try {
      // runAsSystem: this is THE call site that creates a brand new tenant —
      // there is no companyId to scope by yet (it's created inside this very
      // transaction), and this route is @Public() (no req.user, no tenant
      // context from TenantContextInterceptor). See the RLS migration's
      // comment and the RLS report for the full reasoning on this bypass.
      user = await runAsSystem(() =>
        runTenantInteractiveTransaction(this.prisma, async (tx) => {
          const company = await tx.company.create({ data: { name: dto.companyName } });
          return tx.user.create({
            data: {
              companyId: company.id,
              email: dto.email,
              passwordHash,
              role: 'ADMIN',
              modules: ALL_MODULES,
            },
          });
        }),
      );
    } catch (err) {
      // P2002 = unique constraint violation on User.email. Sem isso, um
      // e-mail duplicado (retry do usuário, ou dois cadastros concorrentes)
      // vazava como 500 opaco em vez de um erro de negócio claro.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Este e-mail já está cadastrado');
      }
      throw err;
    }
    const accessToken = this.signAccessToken(user);
    const refreshValue = await this.issueRefreshToken(user.id);
    this.setRefreshCookie(res, refreshValue);
    // register() é o único lugar onde o próprio usuário escolhe a senha (não
    // uma temporária gerada pelo sistema) — mustChangePassword nasce false
    // aqui, ao contrário de UsersService.create().
    return {
      accessToken,
      user: { id: user.id, email: user.email, role: user.role, modules: user.modules, mustChangePassword: user.mustChangePassword },
    };
  }

  async login(dto: { email: string; password: string }, res: Response) {
    // runAsSystem: email is globally unique (not scoped to a company), and
    // there is no way to know which company a user belongs to before we've
    // found them by email — this lookup is legitimately cross-tenant by
    // necessity. See the RLS migration's comment for the full reasoning.
    const user = await runAsSystem(() => this.prisma.user.findUnique({ where: { email: dto.email } }));
    // Mensagem genérica de propósito — nunca revelar se foi o e-mail ou a
    // senha que errou, isso ajudaria alguém tentando adivinhar contas válidas.
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    const accessToken = this.signAccessToken(user);
    const refreshValue = await this.issueRefreshToken(user.id);
    this.setRefreshCookie(res, refreshValue);
    return {
      accessToken,
      user: { id: user.id, email: user.email, role: user.role, modules: user.modules, mustChangePassword: user.mustChangePassword },
    };
  }

  async refresh(refreshCookieValue: string | undefined, res: Response) {
    if (!refreshCookieValue) throw new UnauthorizedException('Sessão não encontrada');
    const tokenHash = hashRefreshToken(refreshCookieValue);
    // runAsSystem: `include: { user: true }` joins against the RLS-protected
    // User table before any tenant context exists for this request (this
    // route is @Public()) — same reasoning as login() above.
    const existing = await runAsSystem(() =>
      this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } }),
    );
    if (!existing || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Sessão expirada, faça login novamente');
    }
    if (existing.revokedAt || existing.replacedByTokenId) {
      // Token já usado antes sendo reapresentado — sinal de roubo/replay.
      // Revoga TODA a família de tokens deste usuário, não só este.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sessão inválida, faça login novamente');
    }
    if (existing.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Login bloqueado');
    }
    const accessToken = this.signAccessToken(existing.user);
    const newRefreshValue = await this.issueRefreshToken(existing.userId, existing.id);
    this.setRefreshCookie(res, newRefreshValue);
    return { accessToken };
  }

  async logout(refreshCookieValue: string | undefined, res: Response) {
    if (refreshCookieValue) {
      const tokenHash = hashRefreshToken(refreshCookieValue);
      await this.prisma.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/auth' });
  }

  async changePassword(userId: string, dto: { currentPassword: string; newPassword: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Senha atual incorreta');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    // Mesmo padrão de UsersService.block(): update de senha + revogação de
    // TODOS os refresh tokens ativos numa única $transaction. Sem isso, um
    // usuário que troca a senha por suspeita de conta comprometida deixaria
    // um invasor com um refresh token já válido (não expirado, não
    // revogado) logado indefinidamente — a troca de senha "resolveria" nada
    // pra esse invasor. mustChangePassword some aqui também: é exatamente o
    // ato que ele existe pra forçar.
    await runTenantTransaction(this.prisma, [
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    // JwtAuthGuard agora bloqueia qualquer rota de negócio enquanto o access
    // token carregar mustChangePassword: true (ver esse guard) — o token
    // emitido no login/refresh anterior a esta troca ainda carrega esse
    // claim e só perderia isso naturalmente em até 15min (expiração) ou num
    // próximo /auth/refresh. Sem emitir um token novo aqui, a UX já validada
    // de "acesso imediato ao app logo após a troca forçada, sem precisar
    // logar de novo" quebraria. `user` já foi buscado (com companyId/role/
    // modules) antes da troca — só o valor de mustChangePassword muda.
    const accessToken = this.signAccessToken({ ...user, mustChangePassword: false });
    return { accessToken };
  }

  // Usado por GET /auth/me — devolve o MESMO formato de `user` que
  // login()/register() já devolvem ({ id, email, role, modules,
  // mustChangePassword }), não os claims crus do JWT (que não carregam
  // `email`/`mustChangePassword`). Mantém o frontend com um único formato de
  // perfil pra lidar, venha ele de login ou de uma renovação de sessão após
  // reload.
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      modules: user.modules,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
