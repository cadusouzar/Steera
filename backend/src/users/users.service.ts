import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runInsideExplicitTenantTransaction } from '../prisma/tenant-context';
import { hashPassword } from '../auth/password.util';
import { effectiveHasFullPontoAccess } from '../auth/ponto-access.util';
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
  status: true,
  mustChangePassword: true,
  hasFullPontoAccess: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
      user = await this.prisma.user.create({
        data: {
          companyId,
          email: dto.email,
          passwordHash,
          role: dto.role,
          employeeId: dto.role === 'EMPLOYEE' ? dto.employeeId : null,
          modules: dto.modules,
          // Sempre true aqui: quem recebe uma senha gerada pelo sistema (em
          // vez de escolher a própria, como em POST /auth/register) é
          // obrigado a trocá-la no primeiro acesso. Mesmo bug/mesmo fix de
          // AuthService.register() para P2002 abaixo — ver esse catch.
          mustChangePassword: true,
        },
        select: SAFE_USER_SELECT,
      });
    } catch (err) {
      // P2002 = unique constraint violation on User.email. User.email é
      // único GLOBALMENTE (não só por empresa) — sem este catch, criar um
      // login com um e-mail já usado por QUALQUER empresa (inclusive uma
      // completamente diferente) vazava como 500 opaco, e o 500-vs-201
      // funcionava como um oráculo de existência cross-tenant. Mesmo padrão
      // exato já usado em AuthService.register() (ver esse arquivo).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
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
        await tx.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } });
        await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }),
    );
  }

  async unblock(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
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

  // Achado + corrigido na revisão de escopo de 15/09/2026: um login ADMIN de uma empresa pequena/
  // média muitas vezes é só um gerente de confiança, não o dono — este campo deixa a empresa
  // restringir logins ADMIN específicos a "administrar só quem eu comando" dentro do Controle de
  // Ponto (ver TimeManagementAuthService.assertHasFullPontoAccess/canManage). Trava contra deixar a
  // empresa sem NENHUM admin de acesso total, o que só seria recuperável por edição direta no banco.
  async updatePontoAccess(companyId: string, targetUserId: string, hasFullPontoAccess: boolean): Promise<void> {
    const target = await this.prisma.user.findFirst({ where: { id: targetUserId, companyId } });
    if (!target) throw new NotFoundException(`Login ${targetUserId} não encontrado nesta empresa`);
    if (target.role !== 'ADMIN') {
      throw new BadRequestException('hasFullPontoAccess só tem efeito em logins ADMIN');
    }

    if (hasFullPontoAccess) {
      await this.prisma.user.update({ where: { id: targetUserId }, data: { hasFullPontoAccess: true } });
      return;
    }

    // Achado em revisão (15/09/2026): a versão original fazia count() e update() como duas
    // queries separadas, sem nenhuma trava — duas requisições concorrentes desligando DOIS admins
    // diferentes, com exatamente 2 full-access admins restantes, podiam ambas ler count === 2,
    // ambas passar o guard, e ambas escrever false, deixando a empresa com ZERO admins de acesso
    // total (estado irrecuperável sem acesso direto ao banco). Mesmo padrão já usado em
    // TimeClockService.createPunch para a corrida de marcação duplicada:
    // pg_advisory_xact_lock dentro de uma transação travada, recontando a condição DENTRO dela.
    // Trava escopada por EMPRESA (hashtext(companyId)), não por usuário — o invariante protegido
    // ("pelo menos um full-access admin") é por empresa, não por login, então duas requisições da
    // MESMA empresa (mesmo mexendo em admins diferentes) precisam serializar entre si; duas
    // requisições de empresas DIFERENTES nunca se bloqueiam.
    //
    // NUNCA runTenantInteractiveTransaction aqui — achado durante a auditoria de segurança
    // (17/09/2026, mesmo bug do AuthService.changePassword/UsersService.block, ver o comentário
    // completo em changePassword): `User` é tabela CENTRAL, e nenhum client de TENANT (o que
    // `runTenantInteractiveTransaction` sempre usa quando um registry+companyId estão ativos)
    // consegue alcançá-la via `.model.op()` — reproduzia ao vivo "table tenant_x.User does not
    // exist" pra toda empresa com schema físico, ou seja, `hasFullPontoAccess` nunca conseguia ser
    // desligado pra NENHUM admin de NENHUMA empresa nova. A transação é montada à mão: `tx` vem
    // direto do client central, com o `set_config` de RLS emitido manualmente como primeira
    // instrução.
    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId})::bigint)`;

        const fullAccessCount = await tx.user.count({
          where: { companyId, role: 'ADMIN', hasFullPontoAccess: true },
        });
        if (fullAccessCount <= 1) {
          throw new BadRequestException(
            'A empresa precisa manter pelo menos um login ADMIN com acesso total ao Controle de Ponto',
          );
        }

        await tx.user.update({ where: { id: targetUserId }, data: { hasFullPontoAccess: false } });
      }),
    );
  }
}
