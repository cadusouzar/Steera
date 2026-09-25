import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule as AppModuleEnum, Prisma } from '@prisma/client';
import { Response } from 'express';
import { join } from 'path';
import { AuthorizationService } from '../authorization/authorization.service';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { listMigrationNames } from '../prisma/migration-files.util';
import { PrismaService } from '../prisma/prisma.service';
import { getTenantCompanyId, runAsSystem, runInsideExplicitTenantTransaction } from '../prisma/tenant-context';
import { assertValidSchemaName } from '../prisma/tenant-schema.util';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { applyMigrations } from '../prisma/tenant-migration.util';
import { normalizePhone } from '../common/phone.util';
import { maskDocument, normalizeDocument, PersonType } from './document.util';
import { pickCompanyIdentity } from './schema-name-picker.util';
import { RegisterDto } from './dto/register.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { hashPassword, verifyPassword } from './password.util';
import { effectiveHasFullPontoAccess } from './ponto-access.util';
import { generateRefreshTokenValue, hashRefreshToken } from './refresh-token.util';

// `RH` de propósito fora daqui — não é mais atribuído a login novo nenhum, nem o fundador (ver
// RH_CARGOS/RH_FUNCIONARIOS no schema). O fundador via /auth/register continua recebendo TODOS os
// módulos que realmente existem hoje.
const ALL_MODULES: AppModuleEnum[] = [
  'DASHBOARD', 'CLIENTES', 'RH_CARGOS', 'RH_FUNCIONARIOS', 'PONTO_REGISTRO', 'PONTO_ADMINISTRACAO',
  'COMERCIAL', 'OPERACOES', 'FINANCAS',
];
// Campos de Company devolvidos em todo `user` público (login/register/refresh/me). Documento vai
// só mascarado (maskDocument) — o valor cru nunca sai numa resposta.
const PUBLIC_COMPANY_SELECT = {
  name: true, planTier: true, maxEmployeeLogins: true,
  personType: true, document: true, legalName: true, tradeName: true,
  // Telefone/endereço: pra área "Minha conta" do site poder mostrar e editar (PATCH /auth/me/company).
  phone: true, zipCode: true, street: true, number: true, complement: true, district: true, city: true, state: true,
} as const;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const REFRESH_COOKIE_NAME = 'rt';
// Achado durante a auditoria de segurança (17/09/2026): testar manualmente confirmou que o
// rate-limit por janela de tempo (ThrottlerGuard, 5/15min) nunca acaba de verdade — dá pra esperar
// e tentar de novo indefinidamente. Este teto é ortogonal e persistente (nunca reseta sozinho com o
// tempo, só com um login certo ou uma ação de admin) — na 5ª senha errada seguida, a conta trava e
// só um admin destrava (unblock ou reset de senha).
const MAX_FAILED_LOGIN_ATTEMPTS = 5;

// process.cwd(), não __dirname: __dirname aponta pra dentro de `dist/src/auth` depois de compilado
// (`npm run build` + `node dist/main.js`), onde `prisma/` não existe — mesmo padrão já usado em
// FilesService.STORAGE_ROOT (`join(process.cwd(), 'storage', 'attachments')`), que assume
// `npm run start:dev`/`start:prod` sempre rodam com o diretório de trabalho em `backend/`
// (garantido pelo próprio npm, que sempre executa scripts com CWD = pasta do package.json).
const TENANT_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'tenant-migrations');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly authorization: AuthorizationService,
  ) {}

  private async signAccessToken(user: {
    id: string;
    companyId: string;
    role: string;
    modules: string[];
    mustChangePassword: boolean;
    hasFullPontoAccess: boolean;
  }) {
    return this.jwt.sign(
      {
        sub: user.id,
        companyId: user.companyId,
        role: user.role,
        modules: user.modules,
        mustChangePassword: user.mustChangePassword,
        // Sempre o valor EFETIVO (nunca a coluna crua) — ver ponto-access.util.ts. Isto cobre
        // login()/register()/refresh()/changePassword() de uma vez, já que todos assinam o token
        // por aqui.
        hasFullPontoAccess: effectiveHasFullPontoAccess(user),
        // Permissões efetivas do perfil atual (Task 5, ver AuthorizationService) — carregadas no
        // JWT pra PermissionsGuard nunca precisar de uma consulta extra ao banco por requisição.
        permissions: await this.getEffectivePermissionsAsSystem(user.id),
      },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m', algorithm: 'HS256' },
    );
  }

  // Achado crítico pós-Task 5 (verificação manual de uma task posterior): User/ProfilePermission
  // têm FORCE ROW LEVEL SECURITY — sem nenhum contexto de tenant ativo (app.current_company_id) e
  // sem bypass, a política de RLS filtra a linha em silêncio (comportamento documentado do
  // Postgres, já usado no resto deste arquivo), então AuthorizationService.getEffectivePermissions
  // via `this.prisma.user.findUnique` via um client sem contexto nenhum enxergava `undefined` e
  // devolvia `{}` sempre. Isso nunca aparece em teste unitário (mocka AuthorizationService por
  // completo) — só um register()/login() real contra Postgres expõe. register()/login()/refresh()
  // são rotas @Public() sem contexto de tenant ambiente (TenantContextInterceptor só roda em rotas
  // autenticadas) — precisam do mesmo bypass runAsSystem() já usado pelas outras consultas
  // pontuais-por-id deste arquivo (lookup de company em register(), de email em login(), de token em
  // refresh()). AuthorizationService não pode importar runAsSystem diretamente (restrito a
  // src/auth/**/test/** por eslint), daí o wrap acontecer aqui, no call site.
  private getEffectivePermissionsAsSystem(userId: string) {
    return runAsSystem(() => this.authorization.getEffectivePermissions(userId));
  }

  // Formato único do objeto `user` devolvido por register()/login()/getProfile() — montado à mão
  // (nunca o row cru do Prisma) pra nunca vazar passwordHash, e com hasFullPontoAccess já
  // normalizado pelo mesmo helper que assina o JWT, pra o frontend nunca ver um valor diferente do
  // que o token carrega. `company` é opcional só pra não quebrar os testes unitários existentes
  // (mocks de Prisma que não incluem a relação) — todo call site real sempre a inclui via `include`.
  private toPublicUser(user: {
    id: string;
    email: string;
    role: string;
    modules: string[];
    mustChangePassword: boolean;
    employeeId: string | null;
    hasFullPontoAccess: boolean;
    name?: string | null;
    company?: {
      name: string; planTier: string; maxEmployeeLogins: number;
      personType: PersonType | null; document: string | null; legalName: string | null; tradeName: string | null;
      phone?: string | null; zipCode?: string | null; street?: string | null; number?: string | null;
      complement?: string | null; district?: string | null; city?: string | null; state?: string | null;
    } | null;
  }, permissions: Record<string, string | null>) {
    const company = user.company;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      modules: user.modules,
      mustChangePassword: user.mustChangePassword,
      employeeId: user.employeeId,
      hasFullPontoAccess: effectiveHasFullPontoAccess(user),
      permissions,
      companyName: user.company?.name ?? null,
      planTier: user.company?.planTier ?? null,
      maxEmployeeLogins: user.company?.maxEmployeeLogins ?? null,
      name: user.name ?? null,
      personType: user.company?.personType ?? null,
      documentMasked: maskDocument(user.company?.personType ?? null, user.company?.document ?? null),
      legalName: user.company?.legalName ?? null,
      tradeName: user.company?.tradeName ?? null,
      companyPhone: company?.phone ?? null,
      // null pra empresas anteriores ao cadastro ampliado (sem endereço gravado).
      companyAddress: company?.zipCode
        ? {
            zipCode: company.zipCode,
            street: company.street ?? null,
            number: company.number ?? null,
            complement: company.complement ?? null,
            district: company.district ?? null,
            city: company.city ?? null,
            state: company.state ?? null,
          }
        : null,
    };
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

  // P2002 = unique constraint violation on User.email OU Company.document. Sem isso, um
  // e-mail/documento duplicado (retry do usuário, ou dois cadastros concorrentes) vazava como 500
  // opaco em vez de um erro de negócio claro. Colisão de `schemaName` não é mapeada de propósito:
  // pickCompanyIdentity roda sob o lock, então nunca deve acontecer — se acontecer, é bug e deve
  // aparecer como 500 logado.
  //
  // Achado no e2e real contra Postgres (Task 6): pra ALGUMAS violações desta constraint o Prisma
  // devolve `err.meta` SEM `target` (motivo exato não isolado — não acontece com toda violação de
  // unique constraint, só com esta em condições específicas) — o fast path acima nunca reconhece
  // esse caso e relançava o erro cru como 500. Sem `target` pra decidir qual campo colidiu, a única
  // forma confiável de desambiguar é consultar o banco: a transação que falhou já foi desfeita
  // (Postgres reverte TUDO, incluindo o próprio Company/User que colidiram), então esta consulta
  // roda DEPOIS, fora dela, via runAsSystem — mesmo padrão de login() (nenhum tenant conhecido
  // ainda, rota @Public()).
  private async resolveRegisterConflict(err: unknown, dto: RegisterDto, document: string): Promise<never> {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = JSON.stringify(err.meta?.target ?? '');
      if (target.includes('document')) {
        throw new ConflictException(`Já existe uma conta com este ${dto.personType === 'PJ' ? 'CNPJ' : 'CPF'}`);
      }
      if (target.includes('email')) throw new ConflictException('Este e-mail já está cadastrado');

      await this.assertRegisterIdentityAvailable(dto, document);
    }
    throw err;
  }

  // Pré-checagem barata, ANTES do lock global de provisionamento: o caso comum (e-mail/documento já
  // cadastrado) é recusado sem serializar outros cadastros nem montar schema pra nada. Não é a
  // garantia real — dois cadastros simultâneos com o mesmo dado passam os dois por aqui; quem
  // decide é a unique constraint (P2002 → resolveRegisterConflict). runAsSystem: rota @Public(),
  // nenhum tenant no contexto (mesmo padrão de login()).
  private async assertRegisterIdentityAvailable(dto: RegisterDto, document: string): Promise<void> {
    const existingUser = await runAsSystem(() => this.prisma.user.findUnique({ where: { email: dto.email } }));
    if (existingUser) throw new ConflictException('Este e-mail já está cadastrado');
    const existingCompany = await runAsSystem(() => this.prisma.company.findUnique({ where: { document } }));
    if (existingCompany) {
      throw new ConflictException(`Já existe uma conta com este ${dto.personType === 'PJ' ? 'CNPJ' : 'CPF'}`);
    }
  }

  async register(dto: RegisterDto, res: Response) {
    // Normaliza/valida ANTES da transação: erro de documento/telefone nunca chega a pegar o lock
    // global de provisionamento.
    const document = normalizeDocument(dto.personType, dto.document);
    const phone = normalizePhone(dto.phone);
    const tradeName = dto.tradeName?.trim() || null;
    const legalName = dto.legalName.trim();
    const displayName = tradeName ?? legalName;
    await this.assertRegisterIdentityAvailable(dto, document);
    const passwordHash = await hashPassword(dto.password);
    let result: {
      user: { id: string; companyId: string; email: string; role: string; modules: string[]; mustChangePassword: boolean; employeeId: string | null; hasFullPontoAccess: boolean; name: string | null };
      company: {
        name: string; planTier: string; maxEmployeeLogins: number;
        personType: PersonType | null; document: string | null; legalName: string | null; tradeName: string | null;
      };
    };
    try {
      // runAsSystem: this is THE call site that creates a brand new tenant —
      // there is no companyId to scope by yet (it's created inside this very
      // transaction), and this route is @Public() (no req.user, no tenant
      // context from TenantContextInterceptor). See the RLS migration's
      // comment and the RLS report for the full reasoning on this bypass.
      result = await runAsSystem(() =>
        runTenantInteractiveTransaction(this.prisma, async (tx) => {
          // Achado ao rodar a suíte e2e inteira (não previsto no brief): toda migration de tenant
          // que adiciona uma FK pra `companyId` termina em `ALTER TABLE ... REFERENCES
          // "Company"("id")` — a tabela CENTRAL compartilhada por TODAS as empresas, não uma tabela
          // dentro do schema físico novo. Cada `ALTER TABLE ADD CONSTRAINT` desse tipo pede um
          // ShareRowExclusiveLock na tabela referenciada (`Company`); o `tx.company.create()` logo
          // abaixo já segura um RowExclusiveLock nela (do próprio INSERT desta mesma transação).
          // Duas empresas se registrando ao mesmo tempo — cada uma com seu próprio INSERT +
          // dezenas de ALTER TABLE contra a MESMA `Company` — reproduzem de forma determinística um
          // deadlock circular do Postgres (40P01: cada transação segura o RowExclusiveLock da sua
          // própria linha e espera o ShareRowExclusiveLock que a outra está seguindo). Reproduzido
          // ao vivo rodando `npm run test:e2e` sem filtro (múltiplos specs registrando em paralelo,
          // cada um em seu próprio worker do Jest) — sem serialização, ~2 de 3 specs concorrentes
          // falhavam com 500. `pg_advisory_xact_lock` (mesmo padrão já usado em
          // `UsersService.updatePontoAccess`/`TimeClockService.createPunch`, liberado sozinho no
          // commit/rollback, sem precisar de unlock explícito) serializa só esta seção entre
          // registros concorrentes — chave GLOBAL (não por companyId), porque o recurso disputado
          // (`Company`, a tabela central) é compartilhado por toda empresa, não um recurso por
          // tenant. Provisionar uma empresa é raro e nunca um caminho quente, então serializar
          // globalmente aqui não tem custo de throughput relevante.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('tenant_provisioning')::bigint)`;
          const { companyId, schemaName } = await pickCompanyIdentity(tx, displayName);
          const company = await tx.company.create({
            data: {
              // id gerado na aplicação: o sufixo do schema são os 8 finais dele (ver tenant-schema.util.ts).
              id: companyId,
              name: displayName,
              schemaName,
              personType: dto.personType,
              document,
              legalName,
              tradeName,
              phone,
              zipCode: dto.zipCode.replace(/\D/g, ''),
              street: dto.street.trim(),
              number: dto.number.trim(),
              complement: dto.complement?.trim() || null,
              district: dto.district.trim(),
              city: dto.city.trim(),
              state: dto.state,
            },
          });
          // "Administrador Geral": perfil protegido do fundador, com TODAS as permissões do
          // catálogo concedidas incondicionalmente (não só as que ALL_MODULES implicaria sob o
          // sistema antigo) — mesmo padrão/nome já usado por scripts/backfill-profiles.ts pra
          // empresas legadas. Profile é central (como Company/User), então tx.profile.create()
          // roteia pro client certo pela mesma razão que tx.company.create()/tx.user.create() já
          // roteiam: nenhum contexto de tenant já resolvido existe ainda neste ponto do fluxo.
          const profile = await tx.profile.create({
            data: {
              companyId: company.id,
              name: 'Administrador Geral',
              isProtected: true,
              permissions: {
                create: PERMISSION_CATALOG.map((def) => ({
                  companyId: company.id,
                  permissionCode: def.code,
                  scope: def.validScopes.length === 0 ? null : 'EMPRESA',
                })),
              },
            },
          });
          assertValidSchemaName(schemaName);
          // CREATE SCHEMA e a migration replay abaixo rodam DENTRO desta mesma transação
          // PostgreSQL — DDL é transacional no Postgres, então qualquer falha (schema, uma
          // migration específica) desfaz TUDO, incluindo o INSERT do Company acima: nunca existe
          // uma empresa com schema pela metade, e uma segunda tentativa após falha é sempre
          // segura (não há sujeira residual pra limpar).
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
          await applyMigrations(tx, company.id, schemaName, TENANT_MIGRATIONS_DIR, listMigrationNames(TENANT_MIGRATIONS_DIR));
          // "User" só existe em `public` — resolve corretamente mesmo com o search_path acima
          // apontando primeiro pro schema do tenant (o PostgreSQL cai pro próximo item da lista).
          const createdUser = await tx.user.create({
            data: {
              companyId: company.id,
              email: dto.email,
              passwordHash,
              role: 'ADMIN',
              modules: ALL_MODULES,
              profileId: profile.id,
              name: dto.name.trim(),
            },
          });
          return { user: createdUser, company };
        }),
      );
    } catch (err) {
      // `throw await ...`: resolveRegisterConflict sempre lança (Promise<never>) — o `throw` aqui é
      // só pra o TypeScript entender que `result` está sempre atribuído depois deste bloco.
      throw await this.resolveRegisterConflict(err, dto, document);
    }
    const { user, company } = result;
    const accessToken = await this.signAccessToken(user);
    const refreshValue = await this.issueRefreshToken(user.id);
    this.setRefreshCookie(res, refreshValue);
    // register() é o único lugar onde o próprio usuário escolhe a senha (não
    // uma temporária gerada pelo sistema) — mustChangePassword nasce false
    // aqui, ao contrário de UsersService.create(). `company` já está em
    // escopo (acabou de ser criado nesta mesma transação), sem precisar de
    // include nenhum.
    const permissions = await this.getEffectivePermissionsAsSystem(user.id);
    return { accessToken, user: this.toPublicUser({ ...user, company }, permissions) };
  }

  async login(dto: { email: string; password: string }, res: Response) {
    // runAsSystem: email is globally unique (not scoped to a company), and
    // there is no way to know which company a user belongs to before we've
    // found them by email — this lookup is legitimately cross-tenant by
    // necessity. See the RLS migration's comment for the full reasoning.
    // `include: { company: ... }` — a tela de perfil do frontend mostra o nome/plano reais da
    // empresa, sem precisar de uma segunda chamada.
    const user = await runAsSystem(() =>
      this.prisma.user.findUnique({
        where: { email: dto.email },
        include: { company: { select: PUBLIC_COMPANY_SELECT } },
      }),
    );
    if (!user) throw new UnauthorizedException('E-mail ou senha inválidos');

    // Confirma a senha ANTES de checar o status — auditoria de segurança (17/09/2026): revelar
    // "esta conta está bloqueada/travada" pra quem nem sabe a senha certa vazaria a existência e o
    // estado de uma conta como um oráculo de enumeração. Só depois da senha bater é seguro dar uma
    // mensagem específica (a pessoa já provou que é quem diz ser).
    if (!(await verifyPassword(user.passwordHash, dto.password))) {
      // Contador persistente de tentativas erradas — nunca reseta com o tempo (diferente do
      // ThrottlerGuard por IP/e-mail, que já existia e continua ativo em paralelo), só com um login
      // certo ou uma ação de admin (unblock/reset de senha). Só incrementa se a conta ainda está
      // ACTIVE — uma já BLOCKED/LOCKED não precisa continuar acumulando.
      if (user.status === 'ACTIVE') {
        const failedLoginAttempts = user.failedLoginAttempts + 1;
        await runAsSystem(() =>
          this.prisma.user.update({
            where: { id: user.id },
            data:
              failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS
                ? { failedLoginAttempts, status: 'LOCKED' }
                : { failedLoginAttempts },
          }),
        );
      }
      // Mesma mensagem genérica sempre, mesmo na tentativa que acabou de travar a conta — nunca
      // revelar o estado da conta pra uma senha errada.
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    if (user.status === 'BLOCKED') {
      throw new ForbiddenException('Seu login foi bloqueado. Procure um administrador da sua empresa.');
    }
    if (user.status === 'LOCKED') {
      throw new ForbiddenException(
        'Seu login foi bloqueado por excesso de tentativas. Procure um administrador da sua empresa para redefinir sua senha.',
      );
    }

    if (user.failedLoginAttempts > 0) {
      await runAsSystem(() =>
        this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0 } }),
      );
    }

    const accessToken = await this.signAccessToken(user);
    const refreshValue = await this.issueRefreshToken(user.id);
    this.setRefreshCookie(res, refreshValue);
    const permissions = await this.getEffectivePermissionsAsSystem(user.id);
    return { accessToken, user: this.toPublicUser(user, permissions) };
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
    const accessToken = await this.signAccessToken(existing.user);
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
    // TODOS os refresh tokens ativos numa única transação. Sem isso, um
    // usuário que troca a senha por suspeita de conta comprometida deixaria
    // um invasor com um refresh token já válido (não expirado, não
    // revogado) logado indefinidamente — a troca de senha "resolveria" nada
    // pra esse invasor. mustChangePassword some aqui também: é exatamente o
    // ato que ele existe pra forçar.
    //
    // NUNCA runTenantTransaction/runTenantInteractiveTransaction aqui — achado durante a auditoria
    // de segurança (17/09/2026), em duas rodadas:
    //
    // 1ª tentativa (a forma em array de runTenantTransaction, o código original): reproduzia ao
    // vivo um 500 ("Record to update not found") pra toda empresa com schema físico
    // (schema-per-tenant), porque as duas operações pré-construídas via `this.prisma` eram
    // resolvidas dentro do `insideExplicitTx: true` do client de TENANT redirecionado, o que
    // disparava CADA operação direto no client CENTRAL (de onde vieram) sem o `set_config` de RLS
    // que só tinha sido emitido na conexão do client de tenant — a política de RLS de `User` (a
    // única tabela central com RLS, ver migration `enable_row_level_security`) filtrava a linha
    // como invisível.
    //
    // 2ª tentativa (runTenantInteractiveTransaction, com um `tx` de verdade): piorou pra um erro
    // ainda mais claro — "table tenant_x.User does not exist" — porque `tx` aqui vem de
    // `registry.withClient(...)`, um PrismaClient cujo `datasourceUrl` tem `?schema=tenant_x`
    // embutido; pra QUALQUER query estruturada (não-raw) desse client, o engine do Prisma
    // qualifica a tabela com esse schema fixo no nível da conexão, nunca com o `search_path` de
    // runtime (que só importa pra SQL bruto solto, tipo `$queryRawUnsafe`). `User`/`RefreshToken`
    // são tabelas CENTRAIS, só existem em `public` — não existe client de tenant nenhum capaz de
    // alcançá-las via `.model.op()`, ponto. As duas transaction helpers deste arquivo (ver
    // tenant-rls.extension.ts) foram desenhadas pra SEMPRE redirecionar pro client de tenant quando
    // um registry + companyId estão ativos — o que é certo pras tabelas de tenant, mas não tem
    // NENHUM caminho de volta pro client central quando a operação é 100% central. Por isso este
    // call site (e o irmão em UsersService.block) monta a transação central manualmente: pega o
    // `tx` do `this.prisma` (client central, schema=public) diretamente via `$transaction`, emite o
    // `set_config` de RLS à mão como primeira instrução (mesma coisa que a extensão já faria
    // sozinha pra uma chamada avulsa — só precisa ser explícito aqui porque `insideExplicitTx`
    // suprime esse comportamento automático pras chamadas seguintes dentro do mesmo `tx`) e só
    // então as duas operações de negócio, tudo atômico na mesma conexão.
    const companyId = getTenantCompanyId();
    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
        await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }),
    );
    // JwtAuthGuard agora bloqueia qualquer rota de negócio enquanto o access
    // token carregar mustChangePassword: true (ver esse guard) — o token
    // emitido no login/refresh anterior a esta troca ainda carrega esse
    // claim e só perderia isso naturalmente em até 15min (expiração) ou num
    // próximo /auth/refresh. Sem emitir um token novo aqui, a UX já validada
    // de "acesso imediato ao app logo após a troca forçada, sem precisar
    // logar de novo" quebraria. `user` já foi buscado (com companyId/role/
    // modules) antes da troca — só o valor de mustChangePassword muda.
    const accessToken = await this.signAccessToken({ ...user, mustChangePassword: false });
    return { accessToken };
  }

  // Usado por GET /auth/me — devolve o MESMO formato de `user` que
  // login()/register() já devolvem ({ id, email, role, modules,
  // mustChangePassword }), não os claims crus do JWT (que não carregam
  // `email`/`mustChangePassword`). Mantém o frontend com um único formato de
  // perfil pra lidar, venha ele de login ou de uma renovação de sessão após
  // reload.
  // PATCH /auth/me — nome do próprio login (User é central; o contexto de tenant da requisição já
  // restringe a RLS à empresa do próprio usuário).
  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.prisma.user.update({ where: { id: userId }, data: { name: dto.name } });
    return this.getProfile(userId);
  }

  // PATCH /auth/me/company (só ADMIN, ver controller) — dados cadastrais da empresa. Nunca mexe em
  // `document`/`personType` (não fazem parte do DTO) nem em `schemaName` (imutável, protegido por
  // trigger): mudar o nome fantasia muda o nome de EXIBIÇÃO (`name`), não o schema físico.
  async updateCompany(userId: string, companyId: string, dto: UpdateCompanyDto) {
    const phone = normalizePhone(dto.phone);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { personType: true } });
    const tradeName = dto.tradeName?.trim() || null;
    if (company.personType === 'PJ' && !tradeName) {
      throw new BadRequestException('Nome fantasia é obrigatório para Pessoa Jurídica');
    }
    const legalName = dto.legalName.trim();
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: tradeName ?? legalName,
        legalName,
        tradeName,
        phone,
        zipCode: dto.zipCode.replace(/\D/g, ''),
        street: dto.street.trim(),
        number: dto.number.trim(),
        complement: dto.complement?.trim() || null,
        district: dto.district.trim(),
        city: dto.city.trim(),
        state: dto.state,
      },
    });
    return this.getProfile(userId);
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { company: { select: PUBLIC_COMPANY_SELECT } },
    });
    const permissions = await this.getEffectivePermissionsAsSystem(userId);
    return this.toPublicUser(user, permissions);
  }

  // Único caminho pelo qual um login se auto-vincula a um Employee já
  // existente (ex.: o admin fundador, criado por POST /auth/register sem
  // nenhum Employee — ver TimeManagementAuthService.resolveOwnEmployee, que
  // depende deste vínculo existir). `employeeId` é o único id que
  // legitimamente vem do body aqui: a identidade do CALLER (userId,
  // companyId) sempre vem de `req.user` via @CurrentUser(), nunca do corpo
  // da requisição — ver AuthController.linkEmployee.
  async linkCurrentUserToEmployee(userId: string, companyId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new BadRequestException(`Funcionário ${employeeId} não encontrado nesta empresa`);

    // Mesma checagem de unicidade que UsersService.create() já faz pra login
    // EMPLOYEE (User.employeeId é @unique no schema) — sem isso, dois logins
    // acabariam "donos" do mesmo funcionário.
    const existingLogin = await this.prisma.user.findUnique({ where: { employeeId } });
    if (existingLogin) throw new BadRequestException('Este funcionário já possui um login vinculado');

    const currentUser = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Não permite trocar um vínculo já existente por esta rota — trocar de
    // funcionário vinculado, se algum dia for necessário, é uma decisão
    // administrativa separada, fora de escopo desta task.
    if (currentUser.employeeId) {
      throw new BadRequestException('Este login já está vinculado a um funcionário — não é possível trocar por esta rota');
    }

    try {
      await this.prisma.user.update({ where: { id: userId }, data: { employeeId } });
    } catch (err) {
      // P2002 = corrida real perdida contra o pre-check `existingLogin` acima (dois logins
      // tentando se vincular ao mesmo funcionário ao mesmo tempo) — sem isso, vazava como 500 cru.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Este funcionário já está vinculado a outro login');
      }
      throw err;
    }
    return this.getProfile(userId);
  }
}
