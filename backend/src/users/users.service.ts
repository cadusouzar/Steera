import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runInsideExplicitTenantTransaction } from '../prisma/tenant-context';
import { hashPassword } from '../auth/password.util';
import { effectiveHasFullPontoAccess } from '../auth/ponto-access.util';
import { deriveHasFullPontoAccessFromGrants, deriveModulesFromGrants } from '../permissions/profile-signature.util';
import { reassignUserProfile } from '../permissions/profile-assignment.util';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { assertNotLastAdminWithFullPontoAccess, assertNotLastHolderOfPermission } from './last-permission-holder.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

const PLAN_LIMITS: Record<string, number> = { BASICO: 10, PRO: 50, EMPRESARIAL: 999_999 };

// Nunca inclui passwordHash — espelha o padrão já usado em AuthService
// (login/register/getProfile), que sempre devolve um objeto montado à mão em
// vez do row cru do Prisma. GET /companies/me/users não tem @Roles('ADMIN')
// (qualquer login autenticado da empresa pode listar), então isso vale tanto
// pra não vazar hash pra admin quanto pra um login EMPLOYEE comum.
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

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

  async create(companyId: string, dto: CreateUserDto) {
    if (dto.role === 'EMPLOYEE') {
      if (!dto.employeeId) throw new BadRequestException('employeeId é obrigatório para login do tipo EMPLOYEE');
      const employee = await this.prisma.employee.findFirst({ where: { id: dto.employeeId, companyId } });
      if (!employee) throw new BadRequestException(`Funcionário ${dto.employeeId} não encontrado nesta empresa`);
      const existingLogin = await this.prisma.user.findUnique({ where: { employeeId: dto.employeeId } });
      if (existingLogin) throw new BadRequestException('Este funcionário já possui um login');

      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
      const activeEmployeeLogins = await this.prisma.user.count({
        where: { companyId, role: 'EMPLOYEE', status: 'ACTIVE' },
      });
      if (activeEmployeeLogins >= company.maxEmployeeLogins) {
        throw new ForbiddenException(
          `Limite de logins de funcionário do plano atual (${company.maxEmployeeLogins}) já foi atingido`,
        );
      }
    }

    const profile = await this.prisma.profile.findFirst({ where: { id: dto.profileId, companyId } });
    if (!profile) throw new BadRequestException(`Perfil ${dto.profileId} não encontrado nesta empresa`);

    // Senha temporária FIXA (decisão explícita do produto, não mais gerada
    // aleatoriamente) — devolvida uma única vez na resposta; o hash é o que
    // persiste. Todo login novo criado por um admin nasce com esta mesma
    // senha conhecida e é bloqueado de usar o sistema (JwtAuthGuard, ver
    // esse arquivo) até trocá-la no primeiro acesso via
    // PATCH /auth/me/password (mustChangePassword força esse fluxo — ver
    // abaixo e AuthService.changePassword()). 'Mudar@123' satisfaz o
    // @MinLength(8) que ChangePasswordDto exige de newPassword numa troca
    // voluntária futura, mas isso é incidental — essa validação nunca é
    // aplicada à própria senha temporária, só a uma troca posterior.
    const temporaryPassword = 'Mudar@123';
    const passwordHash = await hashPassword(temporaryPassword);

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
              // Sempre true aqui: quem recebe uma senha gerada pelo sistema (em
              // vez de escolher a própria, como em POST /auth/register) é
              // obrigado a trocá-la no primeiro acesso. Mesmo bug/mesmo fix de
              // AuthService.register() para P2002 abaixo — ver esse catch.
              mustChangePassword: true,
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

    return { user: this.toPublicUser(user), temporaryPassword };
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
        await assertNotLastHolderOfPermission(tx, companyId, 'usuarios.gerenciar', userId);
        await tx.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
        await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }),
    );
  }

  async unblock(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    // Reseta failedLoginAttempts também — cobre tanto um BLOCKED (ação de admin) quanto um LOCKED
    // (travado pelo próprio backend por excesso de tentativas, ver AuthService.login()) com a mesma
    // ação: sem isso, um login LOCKED desbloqueado voltaria a travar sozinho na primeira senha
    // errada seguinte, porque o contador nunca foi zerado.
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE', failedLoginAttempts: 0 } });
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
        if (freshUser.profileId) {
          const hadIt = currentGrants.some((g) => g.permissionCode === 'usuarios.gerenciar');
          const willHaveIt = newGrants.some((g) => g.permissionCode === 'usuarios.gerenciar');
          if (hadIt && !willHaveIt) {
            await assertNotLastHolderOfPermission(tx, companyId, 'usuarios.gerenciar', userId);
          }
        }

        // Achado na revisão final da branch (Fase 2a, 22/09/2026): remover
        // PATCH .../ponto-access apagou, sem substituto, as duas proteções que ele carregava —
        // (a) só um ADMIN que já tem acesso total podia mudar o acesso total de OUTRO ADMIN,
        // (b) nunca deixar a empresa sem NENHUM ADMIN de acesso total. hasFullPontoAccess agora
        // é derivado do Perfil (`ponto.administrar@EMPRESA`), então as duas proteções precisam
        // ser recriadas aqui, o único lugar (junto de ProfilesService.update(), ver lá) que pode
        // mudar esse valor efetivo hoje. Só relevante pra ADMIN (EMPLOYEE nunca tem acesso total,
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
        await assertNotLastHolderOfPermission(tx, companyId, 'usuarios.gerenciar', userId);
        await tx.user.delete({ where: { id: userId } });
      }),
    );
  }

  // Redefinição de senha por um admin (17/09/2026) — mesmo padrão de senha temporária fixa de
  // create(), devolvida uma única vez. Também reativa o login (ACTIVE) e zera
  // failedLoginAttempts: é o caminho de saída de um login LOCKED por excesso de tentativas (a outra
  // opção é só unblock(), que mantém a senha antiga — reset é pra quando a senha em si é o
  // problema, ex.: o dono esqueceu ou suspeita que vazou).
  async resetPassword(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);

    const temporaryPassword = 'Mudar@123';
    const passwordHash = await hashPassword(temporaryPassword);

    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.user.update({
          where: { id: userId },
          data: { passwordHash, mustChangePassword: true, status: 'ACTIVE', failedLoginAttempts: 0 },
        });
        await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }),
    );

    return { temporaryPassword };
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
      data: { planTier: dto.planTier, maxEmployeeLogins: PLAN_LIMITS[dto.planTier] },
    });
  }
}
