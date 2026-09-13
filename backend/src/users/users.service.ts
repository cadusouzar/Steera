import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantTransaction } from '../prisma/tenant-rls.extension';
import { hashPassword } from '../auth/password.util';
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
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForCompany(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: SAFE_USER_SELECT,
    });
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

    return { user, temporaryPassword };
  }

  async block(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    // NotFoundException (404), not BadRequestException — consistente com o
    // padrão já usado em RolesService/ReceivablesService para "registro não
    // encontrado nesta empresa" (nunca vaza pra um admin de outra empresa se
    // o id existe em outro tenant).
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    await runTenantTransaction(this.prisma, [
      this.prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
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
}
