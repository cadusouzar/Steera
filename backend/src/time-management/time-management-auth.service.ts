import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Employee } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { findDirectReportIds } from './hierarchy.util';

// Único lugar do projeto que resolve "posso gerenciar o ponto deste
// funcionário" e "qual é o Employee do login atual" — toda task
// administrativa deste plano (Tasks 5-9: bater ponto, ajustes, justificativas,
// listagens administrativas) injeta este serviço em vez de reimplementar a
// mesma checagem. Ver task-4-brief.md para o raciocínio completo.
@Injectable()
export class TimeManagementAuthService {
  constructor(private readonly prisma: PrismaService) {}

  // `true` se `currentUser.role === 'ADMIN'` **do mesmo company do funcionário-alvo**, ou se o
  // Employee vinculado ao login atual é o `managerId` DIRETO do funcionário-alvo. Não resolve
  // cadeias de gerência mais longas (ex.: gerente do gerente) — escopo deliberadamente restrito a
  // supervisão direta nesta task.
  //
  // A checagem `companyId` acontece ANTES do bypass de ADMIN de propósito — encontrado durante a
  // verificação ao vivo da Task 8 (proactiveCorrect): todo OUTRO chamador deste método (approve/
  // reject/getStatus/createPunch/...) já filtrava o alvo por `companyId: user.companyId` numa
  // consulta anterior antes de chegar aqui, então o bypass cego de ADMIN nunca tinha sido
  // exercitado com um `targetEmployeeId` de fato cross-tenant — até proactiveCorrect(), que passa
  // o `employeeId` da URL direto pra cá sem nenhuma consulta prévia. Um ADMIN de QUALQUER empresa
  // conseguia "corrigir" o ponto de um funcionário de OUTRA empresa só sabendo/adivinhando o id
  // dele — reproduzido ao vivo (HTTP 201 antes deste fix). Buscar o `target` escopado por empresa
  // primeiro, e só então checar o role, fecha essa lacuna pra TODOS os chamadores atuais e
  // futuros, sem exigir que cada um lembre de pré-escopar por empresa antes de chamar.
  async canManage(currentUser: AuthenticatedUser, targetEmployeeId: string): Promise<boolean> {
    const target = await this.prisma.employee.findFirst({
      where: { id: targetEmployeeId, companyId: currentUser.companyId },
    });
    if (!target) return false;

    if (currentUser.role === 'ADMIN' && currentUser.hasFullPontoAccess) return true;

    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!currentUserRecord?.employeeId) return false;

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

  // Suporte às listagens administrativas paginadas (Task 8: GET /time-adjustment-requests, Task 9
  // equivalente para justificativas, Task 10: visões agregadas) — em vez de cada uma buscar TODAS
  // as solicitações da empresa e filtrar uma a uma chamando canManage() (N+1 chamadas, e ainda
  // assim incompatível com paginação real no banco), resolve de uma vez o conjunto de employeeIds
  // que o login atual pode gerenciar, pra usar direto num `where: { employeeId: { in: [...] } }`.
  // 'ALL' sinaliza ADMIN (não precisa materializar a lista inteira de funcionários da empresa).
  async getManageableEmployeeIds(currentUser: AuthenticatedUser): Promise<string[] | 'ALL'> {
    if (currentUser.role === 'ADMIN' && currentUser.hasFullPontoAccess) return 'ALL';

    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!currentUserRecord?.employeeId) return [];

    return findDirectReportIds(this.prisma, currentUser.companyId, currentUserRecord.employeeId);
  }

  // Achado na revisão final de 14/09/2026: a aba de Correção Proativa da tela administrativa
  // usava `GET /employees` (a listagem completa da empresa, correta pra outras telas) como fonte
  // do seletor de funcionário, mostrando mais opções do que as que um superior direto de fato
  // consegue corrigir (o backend já bloqueava a tentativa com 404, mas o seletor confundia o
  // usuário oferecendo opções que nunca funcionariam). Reaproveita getManageableEmployeeIds() —
  // nunca uma segunda implementação da mesma regra — só some as strings-id por uma consulta com
  // nome, e só devolve funcionários ATIVOS (corrigir o ponto de alguém desligado não faz sentido).
  async listManageableEmployees(currentUser: AuthenticatedUser): Promise<{ id: string; fullName: string }[]> {
    const manageable = await this.getManageableEmployeeIds(currentUser);
    if (manageable !== 'ALL' && manageable.length === 0) return [];

    return this.prisma.employee.findMany({
      where: {
        companyId: currentUser.companyId,
        status: 'ACTIVE',
        ...(manageable === 'ALL' ? {} : { id: { in: manageable } }),
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  // Responde só "o Employee vinculado ao login atual aparece como managerId de alguém ATIVO?" —
  // deliberadamente SEM o bypass 'ALL' de getManageableEmployeeIds. Achado na revisão final de
  // 15/09/2026: o frontend derivava "tenho time próprio" de `listManageableEmployees().length > 0`,
  // que pra um ADMIN de acesso total devolve a empresa INTEIRA — então qualquer admin com um
  // Employee vinculado via o botão "Minha equipe" mesmo sem nenhum subordinado direto, e a
  // configuração de time que ele salvasse ali não valeria pra ninguém. Esta consulta é sempre a
  // mesma do ramo EMPLOYEE de getManageableEmployeeIds, só que incondicional.
  async hasDirectReports(currentUser: AuthenticatedUser): Promise<boolean> {
    const currentUserRecord = await this.prisma.user.findUnique({ where: { id: currentUser.userId } });
    if (!currentUserRecord?.employeeId) return false;

    const count = await this.prisma.employee.count({
      where: { managerId: currentUserRecord.employeeId, companyId: currentUser.companyId, status: 'ACTIVE' },
    });
    return count > 0;
  }

  // Ações sem "um funcionário-alvo" pra checar via canManage() — editar o padrão da empresa de
  // TimeTrackingSettings/WorkSchedule, mutar WorkLocation, e o endpoint de ligar/desligar
  // hasFullPontoAccess de outro login. Síncrono de propósito (sem consulta ao banco) — o dado já
  // está inteiro no AuthenticatedUser vindo do JWT.
  assertHasFullPontoAccess(user: AuthenticatedUser): void {
    if (user.role !== 'ADMIN' || !user.hasFullPontoAccess) {
      throw new NotFoundException('Recurso não encontrado');
    }
  }
}
