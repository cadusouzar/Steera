import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { generateRefreshTokenValue } from '../auth/refresh-token.util';
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

    // Senha temporária de alta entropia — devolvida uma única vez na resposta;
    // o hash é o que persiste. O login troca no primeiro acesso via
    // PATCH /auth/me/password.
    const temporaryPassword = generateRefreshTokenValue().slice(0, 16);
    const passwordHash = await hashPassword(temporaryPassword);

    const user = await this.prisma.user.create({
      data: {
        companyId,
        email: dto.email,
        passwordHash,
        role: dto.role,
        employeeId: dto.role === 'EMPLOYEE' ? dto.employeeId : null,
        modules: dto.modules,
      },
      select: SAFE_USER_SELECT,
    });

    return { user, temporaryPassword };
  }

  async block(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    // NotFoundException (404), not BadRequestException — consistente com o
    // padrão já usado em RolesService/ReceivablesService para "registro não
    // encontrado nesta empresa" (nunca vaza pra um admin de outra empresa se
    // o id existe em outro tenant).
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { status: 'BLOCKED' } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async unblock(companyId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException(`Login ${userId} não encontrado nesta empresa`);
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
  }

  updatePlan(companyId: string, dto: UpdatePlanDto) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: { planTier: dto.planTier, maxEmployeeLogins: PLAN_LIMITS[dto.planTier] },
    });
  }
}
