import { ForbiddenException, Inject, Injectable, NotFoundException, Scope as NestScope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { Scope } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuthorizationService } from './authorization.service';

// "Pode alterar os próprios dados?" (28/09/2026): permissão sem escopo exigida, ALÉM da permissão e do
// alcance normais da rota, em toda escrita cujo funcionário-alvo é a ficha vinculada ao próprio login
// (salário, pagamentos, férias/afastamentos, advertências, desativar/reativar).
export const OWN_DATA_PERMISSION = 'funcionarios.proprios.gerenciar';
export const OWN_DATA_DENIED_MESSAGE =
  'Seu perfil não permite alterar os próprios dados. Fale com quem administra os acessos da empresa.';

// Ponte entre `req.user.permissions` (claim do JWT) e o resto do backend: resolve, pra UMA
// permissão específica, quais Employee.id um handler pode enxergar/administrar — sempre por
// requisição (`@Injectable({ scope: Scope.REQUEST })`, mesmo padrão de CompanyContextService),
// nunca compartilhado entre chamadas de logins diferentes.
//
// `Scope` do `@nestjs/common` (o enum de lifetime de provider) e `Scope` do `@prisma/client` (o
// enum PROPRIO/EQUIPE/DEPARTAMENTO/EMPRESA) têm o mesmo nome — importado com alias pra nunca
// confundir os dois.
@Injectable({ scope: NestScope.REQUEST })
export class EmployeeScopeService {
  // Cache por requisição: mais de uma chamada pro MESMO código de permissão dentro do mesmo handler
  // (ex.: `assertEmployeeInScope` seguido de `whereEmployeeIn` pra montar a listagem) reaproveita a
  // mesma resolução, sem repetir a consulta de hierarquia/departamento.
  private readonly cache = new Map<string, Promise<string[] | 'ALL'>>();

  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly authorization: AuthorizationService,
  ) {}

  private get currentUser(): AuthenticatedUser {
    const user = (this.request as { user?: AuthenticatedUser }).user;
    if (!user) throw new Error('EmployeeScopeService chamado fora de uma requisição autenticada');
    return user;
  }

  async allowedEmployeeIds(permissionCode: string): Promise<string[] | 'ALL'> {
    const cached = this.cache.get(permissionCode);
    if (cached) return cached;
    const resolved = this.resolve(permissionCode);
    this.cache.set(permissionCode, resolved);
    return resolved;
  }

  private async resolve(permissionCode: string): Promise<string[] | 'ALL'> {
    const user = this.currentUser;
    const scope = user.permissions[permissionCode];
    // Permissão ausente do mapa (login não tem esse código) → conjunto vazio, nunca 'ALL'.
    if (scope === undefined) return [];
    // Presente com escopo `null` (permissão sem noção de alcance, ex. `usuarios.gerenciar`) → 'ALL'.
    if (scope === null) return 'ALL';
    return this.authorization.resolveScope(scope as Scope, user);
  }

  // `notFoundMessage` opcional: rotas endereçadas pelo id de um registro dependente (pagamento,
  // agendamento de férias etc.) passam a mensagem de "não encontrado" do PRÓPRIO recurso, pra quem
  // está fora do alcance não descobrir que aquele registro existe.
  async assertEmployeeInScope(permissionCode: string, employeeId: string, notFoundMessage?: string): Promise<void> {
    const ids = await this.allowedEmployeeIds(permissionCode);
    if (ids === 'ALL') return;
    if (ids.includes(employeeId)) return;
    // Mesma mensagem exata de EmployeesService.findOne — fora do alcance nunca revela que o
    // funcionário existe (404, nunca 403), mesmo padrão já usado em todo o resto do backend.
    throw new NotFoundException(notFoundMessage ?? `Funcionário ${employeeId} não encontrado`);
  }

  async whereEmployeeIn(permissionCode: string, field = 'id'): Promise<Record<string, unknown>> {
    const ids = await this.allowedEmployeeIds(permissionCode);
    if (ids === 'ALL') return {};
    return { [field]: { in: ids } };
  }

  // Chamado nas rotas de ESCRITA logo DEPOIS de assertEmployeeInScope (fora do alcance continua
  // sendo 404 primeiro; este 403 só existe pra registros dentro do alcance). O vínculo login ->
  // funcionário vem do banco (User.employeeId), a mesma fonte do alcance PROPRIO/EQUIPE; a permissão
  // vem do claim do JWT, como todas as outras deste serviço. Login sem funcionário vinculado nunca é
  // "o próprio" de ninguém.
  async assertCanWriteOwn(employeeId: string): Promise<void> {
    const user = this.currentUser;
    if (user.permissions[OWN_DATA_PERMISSION] !== undefined) return;
    const ownEmployeeId = await this.authorization.getOwnEmployeeIdOrNull(user);
    if (!ownEmployeeId || ownEmployeeId !== employeeId) return;
    throw new ForbiddenException({ statusCode: 403, code: 'PERMISSION_REQUIRED', message: OWN_DATA_DENIED_MESSAGE });
  }
}
