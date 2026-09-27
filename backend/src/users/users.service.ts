import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { runInsideExplicitTenantTransaction } from '../prisma/tenant-context';
import { hashPassword } from '../auth/password.util';
import { effectiveHasFullPontoAccess } from '../auth/ponto-access.util';
import { deriveHasFullPontoAccessFromGrants, deriveModulesFromGrants } from '../permissions/profile-signature.util';
import { reassignUserProfile } from '../permissions/profile-assignment.util';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { assertNotLastAdminWithFullPontoAccess, assertNotLastHolderOfPermission } from './last-permission-holder.util';
import { LAST_HOLDER_PROTECTED_PERMISSION_CODES } from '../permissions/protected-permissions';
import { planLimit } from '../plans/plan-catalog';
import { assertBelowPlanLimit, PLAN_COUNTED_LOGIN_STATUSES } from '../plans/plan-limits.util';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteMailer } from '../auth/user-tokens/invite-mailer';
import { UserTokensService } from '../auth/user-tokens/user-tokens.service';
import { EmailService } from '../email/email.service';
import { buildAppLink, passwordResetTemplate } from '../email/email-templates';
import { UpdatePlanDto } from './dto/update-plan.dto';

// Nunca inclui passwordHash — espelha o padrão já usado em AuthService
// (login/register/getProfile), que sempre devolve um objeto montado à mão em
// vez do row cru do Prisma. GET /companies/me/users exige `usuarios.gerenciar`
// (Task 6, 27/09/2026), que pode estar num login EMPLOYEE — então isso vale tanto
// pra não vazar hash pra admin quanto pra um login EMPLOYEE com a permissão.
const SAFE_USER_SELECT = {
  id: true,
  companyId: true,
  email: true,
  role: true,
  employeeId: true,
  modules: true,
  profileId: true,
  status: true,
  mustChangePassword: true,
  hasFullPontoAccess: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeManagementAuth: TimeManagementAuthService,
    private readonly inviteMailer: InviteMailer,
    private readonly userTokens: UserTokensService,
    private readonly email: EmailService,
  ) {}

  private countPlanEmployeeLogins(companyId: string): Promise<number> {
    return this.prisma.user.count({ where: { companyId, role: 'EMPLOYEE', status: { in: PLAN_COUNTED_LOGIN_STATUSES } } });
  }

  // Nome da empresa (vai no assunto/corpo do convite) + emissão/envio. Rota autenticada de ADMIN: o
  // envio é AGUARDADO (sem preocupação de enumeração aqui) pra resposta poder dizer se saiu (`sent`).
  private async sendInvite(companyId: string, userId: string, email: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true } });
    return this.inviteMailer.sendInvite(userId, email, company.name);
  }

  // hasFullPontoAccess sempre normalizado antes de sair daqui (ver ponto-access.util.ts) — a
  // coluna crua nasce `true` pra TODA linha, inclusive logins EMPLOYEE, que nunca têm acesso total
  // de fato. Sem isso, a tela de Usuários e Acessos exibiria "Acesso total ao Ponto" pra um login
  // que o backend nega em toda mutação.
  private toPublicUser<T extends { role: string; hasFullPontoAccess: boolean }>(user: T): T {
    return { ...user, hasFullPontoAccess: effectiveHasFullPontoAccess(user) };
  }

  async findAllForCompany(companyId: string) {
    const users = await this.prisma.user.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: SAFE_USER_SELECT,
    });
    return users.map((u) => this.toPublicUser(u));
  }

  // Permissões por ação e alcance (Task 6, 27/09/2026): as rotas de Usuários passaram a exigir a
  // permissão `usuarios.gerenciar` em vez do papel ADMIN, então um login EMPLOYEE com essa
  // permissão administra logins. Sem esta regra, ele poderia se promover indiretamente: criar um
  // login ADMIN novo (com convite pro próprio e-mail) ou atribuir o perfil protegido
  // (Administrador Geral, com todas as permissões). Chamador ADMIN segue como antes.
  private assertCallerCanCreateRole(role: 'ADMIN' | 'EMPLOYEE', currentUser: AuthenticatedUser): void {
    if (role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_REQUIRED',
        message: 'Só um administrador pode criar outro login de administrador.',
      });
    }
  }

  private assertCallerCanAssignProfile(profile: { name: string; isProtected: boolean }, currentUser: AuthenticatedUser): void {
    if (profile.isProtected && currentUser.role !== 'ADMIN') {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_REQUIRED',
        message: `Só um administrador pode atribuir o perfil ${profile.name}.`,
      });
    }
  }

  async create(companyId: string, dto: CreateUserDto, currentUser: AuthenticatedUser) {
    // Antes de qualquer leitura: recusa barata e sem efeito colateral.
    this.assertCallerCanCreateRole(dto.role, currentUser);

    if (dto.role === 'EMPLOYEE') {
      if (!dto.employeeId) throw new BadRequestException('employeeId é obrigatório para login do tipo EMPLOYEE');
      const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
      if (!employee) throw new BadRequestException(`Funcionário ${dto.employeeId} não encontrado nesta empresa`);
      const existingLogin = await this.prisma.user.findUnique({ where: { employeeId: dto.employeeId } });
      if (existingLogin) throw new BadRequestException('Este funcionário já possui um login');

      // Planos grátis e pagos (26/09/2026): o teto de logins de funcionário vem do catálogo
      // (plan-catalog.ts), lido a partir de Company.planTier — nunca mais de
      // Company.maxEmployeeLogins (coluna legada, mantida só por consistência em updatePlan()).
      await assertBelowPlanLimit(this.prisma, companyId, 'employeeLogins', () => this.countPlanEmployeeLogins(companyId));
    }

    const profile = await this.prisma.profile.findFirst({ where: { id: dto.profileId, companyId } });
    if (!profile) throw new BadRequestException(`Perfil ${dto.profileId} não encontrado nesta empresa`);
    this.assertCallerCanAssignProfile(profile, currentUser);

    // Convite por e-mail ("Acesso e sessões", 26/09/2026) — substitui a antiga senha temporária fixa
    // ('Mudar@123'), que qualquer um que soubesse o e-mail de um login recém-criado podia usar. O
    // login nasce INVITED com o hash de um valor aleatório DESCARTADO na hora (ninguém o conhece; a
    // coluna é NOT NULL, e login() nem chega a verificar senha de INVITED). A senha de verdade é
    // definida pela própria pessoa em POST /auth/accept-invite.
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));

    let user;
    try {
      // Fase 2a (19/09/2026): create() deixou de derivar um Perfil de `modules` (isso agora só
      // acontece no script de backfill legado) — o admin escolhe o Perfil na tela, e `modules`/
      // `hasFullPontoAccess` são DERIVADOS dele, na direção oposta (ver profile-signature.util.ts).
      //
      // Transação montada à mão no client CENTRAL (nunca runTenantTransaction/
      // runTenantInteractiveTransaction) — mesmo padrão e mesmo motivo de block()/remove() logo
      // abaixo: `User`/`Profile`/`ProfilePermission` são tabelas CENTRAIS, inalcançáveis por um
      // client de TENANT. O `set_config` de RLS é emitido manualmente como primeira instrução
      // (Profile/ProfilePermission têm política de RLS por `companyId`).
      user = await runInsideExplicitTenantTransaction(() =>
        this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
          const grants = await tx.profilePermission.findMany({ where: { profileId: dto.profileId } });
          const modules = deriveModulesFromGrants(grants);
          const hasFullPontoAccess = deriveHasFullPontoAccessFromGrants(grants);

          // Achado na 3ª rodada de re-revisão (22/09/2026) — o QUARTO caminho pra mesma escalação,
          // e o único que criava um login NOVO em vez de mexer num existente: um ADMIN restrito
          // podia criar um Perfil com `ponto.administrar@EMPRESA` (inofensivo sozinho — perfil sem
          // ninguém atribuído não concede nada a ninguém) e em seguida criar aqui um login ADMIN
          // novo apontando pra ele, que já nascia com `hasFullPontoAccess: true`. Como a senha
          // temporária era fixa e conhecida ('Mudar@123', substituída por convite por e-mail em
          // 26/09/2026 — o gate continua valendo: o convite pode ir pra um e-mail do próprio
          // atacante), bastava entrar na conta nova. Três chamadas comuns de API, nenhum erro.
          //
          // Só o GATE, nunca o invariante: criar um usuário novo não pode REDUZIR a contagem de
          // admins de acesso total existentes, então `assertOtherAdminGrantsFullPontoAccess`/
          // `assertNotLastAdminWithFullPontoAccess` não têm o que checar aqui.
          if (dto.role === 'ADMIN' && hasFullPontoAccess) {
            this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
          }

          return tx.user.create({
            data: {
              companyId,
              email: dto.email,
              passwordHash,
              role: dto.role,
              employeeId: dto.role === 'EMPLOYEE' ? dto.employeeId : null,
              modules,
              profileId: dto.profileId,
              hasFullPontoAccess,
              // Convite: a pessoa escolhe a própria senha ao aceitar, então não há troca forçada.
              // Aceitar o convite prova posse do e-mail (emailVerifiedAt passa a valer ali).
              status: 'INVITED',
              mustChangePassword: false,
              emailVerifiedAt: null,
            },
            select: SAFE_USER_SELECT,
          });
        }),
      );
    } catch (err) {
      // P2002 = unique constraint violation — User tem DUAS colunas únicas, `email` (global, não só
      // por empresa — sem esse catch, um e-mail já usado por QUALQUER empresa vazava como 500 opaco,
      // e o 500-vs-201 funcionava como um oráculo de existência cross-tenant) e `employeeId` (a
      // checagem `existingLogin` acima é um TOCTOU — uma corrida entre duas requisições ainda cai
      // aqui). `err.meta.target` diz qual coluna colidiu de verdade, pra nunca reportar "e-mail já
      // cadastrado" quando o problema real foi outro funcionário roubando a corrida do vínculo.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]) : [];
        if (target.includes('employeeId')) {
          throw new ConflictException('Este funcionário já está vinculado a outro login');
        }
        throw new ConflictException('Este e-mail já está cadastrado');
      }
      throw err;
    }

    // O login já existe a partir daqui — uma falha ao preparar o convite (ex.: banco indisponível ao
    // emitir o token) nunca desfaz a criação nem vira 500: devolve `inviteUrl: null, sent: false` e o
    // admin usa "Reenviar convite". EmailService.send em si nunca lança (só devolve false).
    let invite: { inviteUrl: string | null; sent: boolean } = { inviteUrl: null, sent: false };
    try {
      invite = await this.sendInvite(companyId, user.id, user.email);
    } catch (err) {
      this.logger.error(`Falha ao preparar o convite do login ${user.id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    return { user: this.toPublicUser(user), inviteUrl: invite.inviteUrl, sent: invite.sent };
  }

  // PATCH /companies/me/users/:id/resend-invite — só pra login ainda INVITED. Reemite o token (o link
  // anterior deixa de valer) e reenvia; devolve o link pro admin poder copiar se o e-mail não chegar.
  async resendInvite(companyId: string, userId: string): Promise<{ inviteUrl: string; sent: boolean }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    if (user.status !== 'INVITED') throw new BadRequestException('Este login já aceitou o convite.');
    return this.sendInvite(companyId, user.id, user.email);
  }

  async block(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    // NotFoundException (404), not BadRequestException — consistente com o
    // padrão já usado em RolesService/ReceivablesService para "registro não
    // encontrado nesta empresa" (nunca vaza pra um admin de outra empresa se
    // o id existe em outro tenant).
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    // NUNCA runTenantTransaction/runTenantInteractiveTransaction aqui — ver o comentário completo
    // em AuthService.changePassword (achado durante a auditoria de segurança, 17/09/2026): `User`/
    // `RefreshToken` são tabelas CENTRAIS, e nenhum client de TENANT consegue alcançá-las via
    // `.model.op()` (o `datasourceUrl` desse client fixa o schema no nível da conexão pro engine do
    // Prisma, não dá pra contornar com `search_path` de runtime) — as duas transaction helpers
    // redirecionam pro client de tenant sempre que um registry+companyId estão ativos, o que nunca
    // tem volta pro client central. Por isso a transação é montada à mão aqui: `tx` vem direto do
    // client central (`this.prisma`), com o `set_config` de RLS emitido manualmente como primeira
    // instrução (a extensão suprime isso pras chamadas seguintes uma vez dentro de
    // `insideExplicitTx`).
    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId})::bigint)`;
        await this.assertNotLastActiveAdmin(tx, companyId, userId);
        for (const code of LAST_HOLDER_PROTECTED_PERMISSION_CODES) {
          await assertNotLastHolderOfPermission(tx, companyId, code, userId);
        }
        await tx.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
        await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }),
    );
  }

  async unblock(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    // Convite pendente: não há o que "reativar" (INVITED já conta no limite e ainda não tem senha) —
    // só limpa uma eventual trava temporária. Promover pra ACTIVE deixaria um login com hash
    // inutilizável e e-mail nunca confirmado, fora do fluxo de aceite.
    if (user.status === 'INVITED') {
      await this.prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null } });
      return;
    }
    // Planos grátis e pagos (26/09/2026): reativar um login EMPLOYEE (de BLOCKED ou LOCKED de volta
    // pra ACTIVE) precisa respeitar o mesmo teto de logins do catálogo que create() já impõe pra um
    // login novo — sem isso, dava pra contornar o limite bloqueando/desbloqueando em vez de criar.
    // Só relevante se o login ainda não está ACTIVE (reativar um já ACTIVE, no-op, nunca é bloqueado
    // por limite). ADMIN nunca é checado — o teto é só de logins EMPLOYEE. A contagem inclui INVITED.
    if (user.role === 'EMPLOYEE' && user.status !== 'ACTIVE') {
      await assertBelowPlanLimit(this.prisma, companyId, 'employeeLogins', () => this.countPlanEmployeeLogins(companyId));
    }
    // Reseta failedLoginAttempts e lockedUntil também — "desbloquear" cobre tanto um BLOCKED (ação de
    // admin) quanto a trava temporária por excesso de senha errada (lockedUntil, ver
    // AuthService.login(); LOCKED é o legado disso): sem zerar, o login voltaria a travar na primeira
    // senha errada seguinte, ou continuaria travado até lockedUntil expirar.
    //
    // Um convite pendente bloqueado e depois desbloqueado volta a INVITED, não ACTIVE (senão ficaria
    // ACTIVE com o hash aleatório inutilizável de create(), fora do fluxo de aceite). block() perde o
    // status INVITED, então o marcador de "nunca aceitou o convite" é: emailVerifiedAt null +
    // emailVerificationRequired false, independente do papel (fix final — um ADMIN convidado também
    // volta a INVITED). Aceitar o convite sempre seta emailVerifiedAt; fundadores têm
    // emailVerificationRequired true; logins legados foram backfillados como confirmados — nenhum
    // desses cai aqui.
    const neverAcceptedInvite = user.emailVerifiedAt === null && user.emailVerificationRequired === false;
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: neverAcceptedInvite ? 'INVITED' : 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  // Troca o Perfil de um login já existente (Fase 2a, 19/09/2026) — substitui tanto a antiga
  // edição direta de `modules` (`PATCH /companies/me/users/:id`, removida) quanto o toggle de
  // `hasFullPontoAccess` (`PATCH .../ponto-access`, removido): os dois agora são SEMPRE derivados
  // do Perfil escolhido, nunca editados em separado (ver spec da Fase 2a).
  async assignProfile(
    companyId: string,
    userId: string,
    profileId: string,
    currentUser: AuthenticatedUser,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    const newProfile = await this.prisma.profile.findFirst({ where: { id: profileId, companyId } });
    if (!newProfile) throw new BadRequestException(`Perfil ${profileId} não encontrado nesta empresa`);
    this.assertCallerCanAssignProfile(newProfile, currentUser);

    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId})::bigint)`;

        // Relido DENTRO da trava (não o `user` capturado antes dela) — fecha uma corrida estreita
        // onde duas reatribuições concorrentes do MESMO usuário poderiam basear a checagem abaixo
        // num `profileId` já desatualizado.
        const freshUser = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const newGrants = await tx.profilePermission.findMany({ where: { profileId } });

        // Um login sem perfil (`profileId: null`, alcançável pelo `onDelete: SetNull` da FK) não
        // concede nada — então os grants "atuais" dele são uma lista VAZIA, não um motivo pra pular
        // as checagens. Achado na re-revisão (22/09/2026): com todo o bloco abaixo aninhado dentro
        // de `if (freshUser.profileId)`, promover justamente esse login pra um perfil de acesso
        // total escapava do gate por completo.
        const currentGrants = freshUser.profileId
          ? await tx.profilePermission.findMany({ where: { profileId: freshUser.profileId } })
          : [];

        // Só esta checagem depende de haver um perfil anterior: "ele tinha `usuarios.gerenciar` e
        // vai perder?" não faz sentido pra quem nunca teve perfil nenhum (não dá pra remover uma
        // permissão que nunca se teve, e a contagem de detentores não muda).
        // Roda pra cada permissão protegida (`usuarios.gerenciar` e `assinatura.gerenciar` — ver
        // protected-permissions.ts).
        if (freshUser.profileId) {
          for (const code of LAST_HOLDER_PROTECTED_PERMISSION_CODES) {
            const hadIt = currentGrants.some((g) => g.permissionCode === code);
            const willHaveIt = newGrants.some((g) => g.permissionCode === code);
            if (hadIt && !willHaveIt) {
              await assertNotLastHolderOfPermission(tx, companyId, code, userId);
            }
          }
        }

        // Achado na revisão final da branch (Fase 2a, 22/09/2026): remover
        // PATCH .../ponto-access apagou, sem substituto, as duas proteções que ele carregava —
        // (a) só um ADMIN que já tem acesso total podia mudar o acesso total de OUTRO ADMIN,
        // (b) nunca deixar a empresa sem NENHUM ADMIN de acesso total. hasFullPontoAccess agora
        // é derivado do Perfil (`ponto.administrar@EMPRESA`), então as duas proteções precisam
        // ser recriadas em CADA caminho capaz de mudar esse valor efetivo. São quatro, todos
        // gateados hoje (auditoria de 22/09/2026, feita depois de três rodadas seguidas acharem um
        // caminho esquecido): este, `UsersService.create()` (login novo já nascendo com acesso
        // total), `ProfilesService.update()` e `ProfilesService.reassignAndDelete()`. Os três
        // últimos escrevem via `recomputeAndSaveUserAccess`, o único writer compartilhado do campo;
        // `AuthService.register()` não conta (não escreve o campo — usa o `@default(true)` da
        // coluna — e é o fundador de uma empresa nova, sem chamador autenticado pra gatear).
        // Só relevante pra ADMIN (EMPLOYEE nunca tem acesso total,
        // por definição — deriveHasFullPontoAccessFromGrants/effectiveHasFullPontoAccess).
        if (freshUser.role === 'ADMIN') {
          const hadFullPonto = deriveHasFullPontoAccessFromGrants(currentGrants);
          const willHaveFullPonto = deriveHasFullPontoAccessFromGrants(newGrants);
          // Gate nos DOIS sentidos: ganhar acesso total é exatamente a escalação que esta proteção
          // existe pra impedir, não só perdê-lo.
          if (hadFullPonto !== willHaveFullPonto) {
            this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
          }
          if (hadFullPonto && !willHaveFullPonto) {
            // Variante de UM usuário (exclui ESTE login, não o perfil inteiro) — ver o comentário
            // longo em `assertNotLastAdminWithFullPontoAccess`: a variante de LOTE usada em
            // ProfilesService descartaria da contagem os OUTROS admins que compartilham este
            // mesmo perfil e que NÃO estão sendo movidos, rejeitando com 400 uma reatribuição
            // individual perfeitamente segura.
            await assertNotLastAdminWithFullPontoAccess(tx, companyId, userId);
          }
        }

        await reassignUserProfile(tx, userId, profileId);
      }),
    );
  }

  // Exclusão de verdade (17/09/2026) — diferente de block(), que é reversível e não some com o
  // registro. "Excluir" aqui é uma decisão deliberada e distinta: apagar de vez um login criado por
  // engano, ou remover o acesso de alguém que não deveria nem deixar rastro. `RefreshToken` tem
  // `onDelete: Cascade` a partir de `User`, então as sessões daquele login somem junto sem precisar
  // de limpeza manual. `employeeId` (se houver) fica livre pra um login novo no futuro.
  async remove(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId})::bigint)`;
        await this.assertNotLastActiveAdmin(tx, companyId, userId);
        for (const code of LAST_HOLDER_PROTECTED_PERMISSION_CODES) {
          await assertNotLastHolderOfPermission(tx, companyId, code, userId);
        }
        await tx.user.delete({ where: { id: userId } });
      }),
    );
  }

  // Redefinição de senha por um admin — "Acesso e sessões" (26/09/2026): em vez de gerar a senha
  // temporária fixa ('Mudar@123'), envia um link de redefinição (PASSWORD_RESET, 30min) pro e-mail do
  // próprio login. NADA muda no login aqui: senha, status e sessões só mudam quando a pessoa de fato
  // redefine (AuthService.resetPassword, que revoga as sessões e nunca desfaz um BLOCKED). Um login
  // INVITED não tem senha pra redefinir — recebe o convite de novo. Nunca devolve senha nenhuma.
  async resetPassword(companyId: string, userId: string): Promise<{ sent: boolean; inviteUrl?: string }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);

    if (user.status === 'INVITED') {
      const { inviteUrl, sent } = await this.sendInvite(companyId, user.id, user.email);
      return { sent, inviteUrl };
    }

    // Sem checagem de teto do plano aqui (fix round 1): o reset não reativa nada, só manda um e-mail —
    // a única reativação real é unblock(), que checa. Conhecido e fora de escopo: um login LOCKED
    // legado volta a ACTIVE sozinho no próximo login certo (AuthService.login) sem passar pelo teto.

    const raw = await this.userTokens.issue(user.id, 'PASSWORD_RESET');
    const sent = await this.email.send(
      { to: user.email, ...passwordResetTemplate(buildAppLink('/redefinir-senha', raw)) },
      'password-reset',
    );
    return { sent };
  }

  // Compartilhado por block()/remove() — nenhuma das duas pode deixar a empresa sem NENHUM login
  // ADMIN ativo, o que só seria recuperável editando o banco direto. Sempre chamado DENTRO da
  // transação travada por pg_advisory_xact_lock(hashtext(companyId)) do chamador, mesmo padrão já
  // usado por updatePontoAccess — recontagem dentro do lock fecha a mesma corrida (duas requisições
  // concorrentes mexendo em dois admins diferentes, cada uma vendo "ainda sobra 1" antes da outra
  // commitar).
  private async assertNotLastActiveAdmin(
    tx: Prisma.TransactionClient,
    companyId: string,
    targetUserId: string,
  ): Promise<void> {
    const target = await tx.user.findUniqueOrThrow({ where: { id: targetUserId } });
    if (target.role !== 'ADMIN' || target.status !== 'ACTIVE') return;
    const activeAdminCount = await tx.user.count({ where: { companyId, role: 'ADMIN', status: 'ACTIVE' } });
    if (activeAdminCount <= 1) {
      throw new BadRequestException('A empresa precisa manter pelo menos um login ADMIN ativo');
    }
  }

  // Sem controller na frente de propósito (ver comentário em users.module.ts) —
  // `PATCH /companies/me/plan` foi removido por deixar o próprio admin da
  // empresa subir seu teto de plano de graça. Até existir um caminho real de
  // cobrança/operador, mudar plano é `UPDATE "Company" ...` manual no banco;
  // este método fica pronto pra ser chamado por esse futuro caminho
  // manual/operator-only, sem precisar reinventar o mapeamento de limites.
  updatePlan(companyId: string, dto: UpdatePlanDto) {
    return this.prisma.company.update({
      where: { id: companyId },
      // maxEmployeeLogins: coluna legada, mantida só por consistência (nada mais lê dela desde que
      // create()/unblock() passaram a usar planLimit(...) direto — ver plan-catalog.ts).
      data: { planTier: dto.planTier, maxEmployeeLogins: planLimit(dto.planTier, 'employeeLogins') ?? 999_999 },
    });
  }
}
