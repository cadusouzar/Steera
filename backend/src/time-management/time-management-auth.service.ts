import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

// Único lugar do projeto que resolve "posso gerenciar o ponto deste
// funcionário" e "qual é o Employee do login atual" — toda task
// administrativa deste plano (Tasks 5-9: bater ponto, ajustes, justificativas,
// listagens administrativas) injeta este serviço em vez de reimplementar a
// mesma checagem. Ver task-4-brief.md para o raciocínio completo.
@Injectable()
export class TimeManagementAuthService {
  constructor(private readonly prisma: PrismaService) {}

  // `true` se `currentUser.role === 'ADMIN'`, ou se o Employee vinculado ao
  // login atual é o `managerId` DIRETO do funcionário-alvo. Não resolve
  // cadeias de gerência mais longas (ex.: gerente do gerente) — escopo
  // deliberadamente restrito a supervisão direta nesta task.
  async canManage(currentUser: AuthenticatedUser, targetEmployeeId: string): Promise<boolean> {
    if (currentUser.role === 'ADMIN') return true;

    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!currentUserRecord?.employeeId) return false;

    // O filtro `companyId` aqui é o que impede um EMPLOYEE de uma empresa
    // gerenciar um funcionário-alvo de outra — mesmo que ele de alguma forma
    // soubesse/adivinhasse o id.
    const target = await this.prisma.employee.findFirst({
      where: { id: targetEmployeeId, companyId: currentUser.companyId },
    });
    if (!target) return false;

    return target.managerId === currentUserRecord.employeeId;
  }

  // 404, nunca 403 — mesmo padrão já estabelecido em todo o resto do backend
  // (RolesService, ReceivablesService, UsersService.block/unblock, etc.) de
  // nunca revelar a um caller não autorizado se o recurso existe ou não.
  async assertCanManage(currentUser: AuthenticatedUser, targetEmployeeId: string): Promise<void> {
    if (!(await this.canManage(currentUser, targetEmployeeId))) {
      throw new NotFoundException(`Funcionário ${targetEmployeeId} não encontrado`);
    }
  }

  // Único lugar do projeto que resolve "o Employee vinculado ao login atual"
  // — todo módulo que precisa bater o próprio ponto/gerenciar o próprio ponto
  // (Tasks 6, 7, 8, 9) injeta este serviço e chama este método, em vez de
  // cada um reimplementar a mesma checagem de vínculo/status.
  async resolveOwnEmployee(currentUser: AuthenticatedUser): Promise<Employee> {
    const record = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!record?.employeeId) {
      throw new ForbiddenException(
        'Seu login ainda não está vinculado a um cadastro de funcionário — vincule antes de continuar',
      );
    }
    const employee = await this.prisma.employee.findUnique({ where: { id: record.employeeId } });
    if (!employee || employee.status !== 'ACTIVE') {
      throw new ForbiddenException('Funcionário inativo não pode realizar esta ação');
    }
    return employee;
  }
}
