import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertCallerCanAssignProfile } from '../users/caller-escalation.util';
import { Scope } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { LAST_HOLDER_PROTECTED_PERMISSION_CODES } from '../permissions/protected-permissions';
import { runInsideExplicitTenantTransaction } from '../prisma/tenant-context';
import { recomputeAndSaveUserAccess, reassignUserProfile } from '../permissions/profile-assignment.util';
import { deriveHasFullPontoAccessFromGrants } from '../permissions/profile-signature.util';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import {
  assertOtherAdminGrantsFullPontoAccess,
  assertOtherProfileGrantsPermission,
} from '../users/last-permission-holder.util';
import { CreateProfileDto, ProfileGrantDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ReassignAndDeleteDto } from './dto/reassign-and-delete.dto';

interface ProfileWithCount {
  id: string;
  name: string;
  isProtected: boolean;
  permissions: { permissionCode: string; scope: Scope | null }[];
  _count: { users: number };
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  async findAllForCompany(companyId: string) {
    const profiles = await this.prisma.profile.findMany({
      where: { companyId },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return profiles.map((p) => this.toPublicProfile(p));
  }

  async findOne(companyId: string, id: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { id, companyId },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    if (!profile) throw new NotFoundException(`Perfil ${id} não encontrado nesta empresa`);
    return this.toPublicProfile(profile);
  }

  async create(companyId: string, dto: CreateProfileDto) {
    this.validateGrants(dto.grants);
    const profile = await this.prisma.profile.create({
      data: {
        companyId,
        name: dto.name,
        isProtected: false,
        permissions: {
          create: dto.grants.map((g) => ({ companyId, permissionCode: g.permissionCode, scope: g.scope ?? null })),
        },
      },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    return this.toPublicProfile(profile);
  }

  async update(companyId: string, id: string, dto: UpdateProfileDto, currentUser: AuthenticatedUser) {
    this.validateGrants(dto.grants);
    const profile = await this.prisma.profile.findFirst({ where: { id, companyId } });
    if (!profile) throw new NotFoundException(`Perfil ${id} não encontrado nesta empresa`);
    if (profile.isProtected) {
      throw new ForbiddenException('Este perfil é protegido e não pode ser editado');
    }

    // Mesma derivação usada em todo o resto do projeto, em vez de uma reimplementação à mão —
    // hoje as duas concordam (validateGrants já rejeita permissionCode duplicado), mas sem isso
    // nada impediria as duas de divergirem numa mudança futura.
    const willGrantFullPonto = deriveHasFullPontoAccessFromGrants(
      dto.grants.map((g) => ({ permissionCode: g.permissionCode, scope: g.scope ?? null })),
    );

    // Transação montada à mão no client CENTRAL (nunca runTenantTransaction/
    // runTenantInteractiveTransaction) — mesmo padrão e mesmo motivo já usado por
    // UsersService.block()/remove(): `User`/`Profile`/`ProfilePermission` são tabelas CENTRAIS,
    // inalcançáveis por um client de TENANT. O `set_config` de RLS é emitido manualmente como
    // primeira instrução.
    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId})::bigint)`;

        // Achado na revisão final da branch (Fase 2a, 22/09/2026, Important #2): antes filtrava
        // `status: 'ACTIVE'` aqui — mas essa é a lista que ALIMENTA a mutação (recálculo de
        // módulos/hasFullPontoAccess abaixo), não só a checagem de trava. Um holder BLOCKED/LOCKED
        // ficava sem o recálculo, voltando com acesso desatualizado (mais amplo do que deveria) ao
        // ser desbloqueado depois. As checagens de trava (`assertOtherProfileGrantsPermission`/
        // `assertOtherAdminGrantsFullPontoAccess`) já filtram ACTIVE internamente, então continuam
        // corretas mesmo sem esse filtro aqui.
        const affectedUsers = await tx.user.findMany({ where: { profileId: id } });
        const currentGrants = await tx.profilePermission.findMany({ where: { profileId: id } });

        // Corrigido numa rodada de revisão de segurança pós-implementação (ver task-4-report.md):
        // a versão original chamava `assertNotLastHolderOfPermission` uma vez POR USUÁRIO afetado,
        // ANTES da reescrita em lote das ProfilePermission abaixo — cada chamada individual via os
        // OUTROS usuários do MESMO perfil ainda "detentores" (a reescrita ainda não tinha
        // acontecido), deixando passar um lote que, ao ser aplicado de uma vez, zerava por completo
        // os detentores ativos de `usuarios.gerenciar` da empresa. `assertOtherProfileGrantsPermission`
        // pergunta a coisa certa pra este caso — "existe algum usuário ativo, em QUALQUER OUTRO
        // perfil, que ainda concede esta permissão?" — e por isso dá a resposta correta rodando
        // antes OU depois da reescrita (mantido antes, por fail-fast, consistente com o resto do
        // método: validar tudo antes de escrever).
        //
        // Achado menor na mesma revisão final (Fase 2a, 22/09/2026): a condição era só
        // `!willGrantUsuariosGerenciar`, sem olhar se o perfil de fato CONCEDIA a permissão antes —
        // editar um perfil que nunca teve `usuarios.gerenciar` (o caso comum) rodava a trava à toa
        // e podia devolver um 400 confuso ("a empresa precisa ter pelo menos um login...") numa
        // edição que não removia nada de ninguém.
        //
        // Roda pra cada permissão protegida (`usuarios.gerenciar` e, desde 27/09/2026,
        // `assinatura.gerenciar` — ver protected-permissions.ts).
        for (const code of LAST_HOLDER_PROTECTED_PERMISSION_CODES) {
          const currentlyGrants = currentGrants.some((g) => g.permissionCode === code);
          const willGrant = dto.grants.some((g) => g.permissionCode === code);
          if (currentlyGrants && !willGrant) {
            await assertOtherProfileGrantsPermission(tx, companyId, code, id);
          }
        }

        // Mesmo achado do Important #1 (ver UsersService.assignProfile) — um dos QUATRO caminhos
        // capazes de mudar o acesso total de Ponto de um ADMIN (os outros três:
        // `UsersService.create()`, `UsersService.assignProfile()` e `reassignAndDelete()` abaixo;
        // lista confirmada por auditoria em 22/09/2026, ver o comentário em assignProfile). Este é
        // o caminho em LOTE: editar um perfil
        // compartilhado por vários ADMINs podendo derrubar `ponto.administrar` de EMPRESA pra algo
        // menor zeraria o acesso total de todos eles de uma vez, sem nenhuma checagem. Só relevante
        // se pelo menos um dos usuários afetados for ADMIN.
        //
        // Achado CRÍTICO na re-revisão (22/09/2026): a primeira versão deste bloco só checava o
        // sentido do REBAIXAMENTO (`currentlyGrantsFullPonto && !willGrantFullPonto`), deixando o
        // sentido da CONCESSÃO completamente aberto — exatamente a escalação que esta rodada
        // inteira existe pra fechar, só que por outro endpoint. `ProfilesController` é
        // `@Roles('ADMIN')` e nada mais, e o perfil de um ADMIN restrito é `isProtected: false`:
        // ele podia editar o PRÓPRIO perfil adicionando `ponto.administrar@EMPRESA` e, com
        // `currentlyGrantsFullPonto === false`, a condição inteira dava `false` e NENHUMA checagem
        // rodava. O gate agora dispara em QUALQUER mudança do acesso total (os dois sentidos),
        // enquanto o invariante segue só no rebaixamento — conceder nunca pode zerar a contagem.
        const hasAffectedAdmin = affectedUsers.some((u) => u.role === 'ADMIN');
        const currentlyGrantsFullPonto = deriveHasFullPontoAccessFromGrants(currentGrants);
        if (hasAffectedAdmin && currentlyGrantsFullPonto !== willGrantFullPonto) {
          this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
        }
        if (hasAffectedAdmin && currentlyGrantsFullPonto && !willGrantFullPonto) {
          await assertOtherAdminGrantsFullPontoAccess(tx, companyId, id);
        }

        await tx.profilePermission.deleteMany({ where: { profileId: id } });
        await tx.profilePermission.createMany({
          data: dto.grants.map((g) => ({ companyId, profileId: id, permissionCode: g.permissionCode, scope: g.scope ?? null })),
        });
        await tx.profile.update({ where: { id }, data: { name: dto.name } });

        for (const user of affectedUsers) {
          await recomputeAndSaveUserAccess(tx, user.id, id);
        }
      }),
    );

    return this.findOne(companyId, id);
  }

  async remove(companyId: string, id: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { id, companyId },
      include: { _count: { select: { users: true } } },
    });
    if (!profile) throw new NotFoundException(`Perfil ${id} não encontrado nesta empresa`);
    if (profile.isProtected) throw new ForbiddenException('Este perfil é protegido e não pode ser excluído');
    if (profile._count.users > 0) {
      throw new BadRequestException(
        `Este perfil está em uso por ${profile._count.users} login(s). Use a opção de reatribuir antes de excluir.`,
      );
    }
    await this.prisma.profile.delete({ where: { id } });
  }

  async reassignAndDelete(
    companyId: string,
    id: string,
    dto: ReassignAndDeleteDto,
    currentUser: AuthenticatedUser,
  ) {
    if (dto.targetProfileId === id) {
      throw new BadRequestException('O perfil de destino precisa ser diferente do excluído');
    }
    const [source, target] = await Promise.all([
      this.prisma.profile.findFirst({ where: { id, companyId } }),
      this.prisma.profile.findFirst({ where: { id: dto.targetProfileId, companyId } }),
    ]);
    if (!source) throw new NotFoundException(`Perfil ${id} não encontrado nesta empresa`);
    if (source.isProtected) throw new ForbiddenException('Este perfil é protegido e não pode ser excluído');
    if (!target) throw new NotFoundException(`Perfil ${dto.targetProfileId} não encontrado nesta empresa`);
    // Task 6, fix round 1: mover logins pro perfil protegido é atribuí-lo — mesma trava de
    // UsersService.create()/assignProfile(), antes de qualquer escrita.
    assertCallerCanAssignProfile(target, currentUser);

    // Transação montada à mão no client CENTRAL (mesmo padrão e mesmo motivo de update() acima):
    // `User`/`Profile`/`ProfilePermission` são tabelas CENTRAIS, inalcançáveis por um client de
    // TENANT. O `set_config` de RLS é emitido manualmente como primeira instrução.
    await runInsideExplicitTenantTransaction(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId})::bigint)`;

        const sourceGrants = await tx.profilePermission.findMany({ where: { profileId: id } });
        const targetGrants = await tx.profilePermission.findMany({ where: { profileId: dto.targetProfileId } });

        // Sem `status: 'ACTIVE'` (revisão final da branch, Fase 2a, 22/09/2026, Important #2 — mesma
        // correção de update()): esta lista alimenta a MUTAÇÃO (mover cada login pro perfil de
        // destino antes de apagar o de origem), não uma checagem. Com o filtro, um holder
        // BLOCKED/LOCKED ficava pra trás e era silenciosamente órfão (`profileId: null`, via o
        // `onDelete: SetNull` da FK) quando `tx.profile.delete` rodava logo abaixo. A trava
        // (`assertOtherProfileGrantsPermission`) já filtra ACTIVE internamente e segue correta.
        const affectedUsers = await tx.user.findMany({ where: { profileId: id } });

        // CORREÇÃO deliberada em relação à brief original (ver task-5-report.md): a brief pedia um
        // loop chamando `assertNotLastHolderOfPermission` uma vez POR usuário afetado — exatamente
        // o mesmo padrão de bug já achado e corrigido em `update()` (ver comentário lá e
        // task-4-report.md): cada checagem individual, rodando ANTES da reatribuição em lote
        // abaixo, veria os OUTROS usuários do MESMO perfil origem ainda "detentores" (a
        // reatribuição ainda não rodou), deixando passar um lote que, aplicado por inteiro, zera os
        // detentores ativos de `usuarios.gerenciar` da empresa de uma vez. `assertOtherProfileGrantsPermission`
        // pergunta a coisa certa pra este cenário — "excluindo o PERFIL de origem sendo esvaziado,
        // existe algum usuário ativo, em QUALQUER OUTRO perfil, que ainda concede esta permissão?"
        // — e por isso só precisa ser chamada UMA vez, não uma vez por usuário.
        // Roda pra cada permissão protegida (ver protected-permissions.ts).
        for (const code of LAST_HOLDER_PROTECTED_PERMISSION_CODES) {
          const sourceHasIt = sourceGrants.some((g) => g.permissionCode === code);
          const targetHasIt = targetGrants.some((g) => g.permissionCode === code);
          if (sourceHasIt && !targetHasIt) {
            await assertOtherProfileGrantsPermission(tx, companyId, code, id);
          }
        }

        // Mesma proteção de acesso total ao Ponto já aplicada em `update()` e em
        // `UsersService.assignProfile()` (revisão final da branch, Fase 2a, 22/09/2026). A brief
        // desta rodada marcava este ponto como OPCIONAL, mas aposentar um perfil por reatribuição é
        // de fato mais um dos quatro caminhos capazes de mudar o acesso total de um ADMIN — inclusive na
        // direção perigosa: um ADMIN restrito pode excluir o PRÓPRIO perfil restrito reatribuindo a
        // si mesmo pro perfil de acesso total, exatamente a escalação que o gate de
        // `assignProfile()` passou a barrar. Fechado aqui com o mesmo par gate+invariante, pra não
        // deixar uma porta lateral aberta pra mesma classe de bug.
        const sourceFullPonto = deriveHasFullPontoAccessFromGrants(sourceGrants);
        const targetFullPonto = deriveHasFullPontoAccessFromGrants(targetGrants);
        const hasAffectedAdmin = affectedUsers.some((u) => u.role === 'ADMIN');
        if (hasAffectedAdmin && sourceFullPonto !== targetFullPonto) {
          this.timeManagementAuth.assertHasFullPontoAccess(currentUser);
        }
        if (hasAffectedAdmin && sourceFullPonto && !targetFullPonto) {
          await assertOtherAdminGrantsFullPontoAccess(tx, companyId, id);
        }

        // Sequencial de propósito, mesmo motivo de update() — ver Global Constraints do plano.
        for (const user of affectedUsers) {
          await reassignUserProfile(tx, user.id, dto.targetProfileId);
        }

        await tx.profile.delete({ where: { id } });
      }),
    );
  }

  // Reaproveitado pelas Tasks 4/5 (validação idêntica ao editar) — método protegido, não privado.
  protected validateGrants(grants: ProfileGrantDto[]): void {
    for (const g of grants) {
      const def = PERMISSION_CATALOG.find((p) => p.code === g.permissionCode);
      if (!def) throw new BadRequestException(`Permissão desconhecida: ${g.permissionCode}`);
      if (def.validScopes.length === 0) {
        if (g.scope != null) {
          throw new BadRequestException(`A permissão "${def.labelPt}" não aceita alcance (scope)`);
        }
      } else if (g.scope == null || !def.validScopes.includes(g.scope)) {
        throw new BadRequestException(
          `A permissão "${def.labelPt}" precisa de um alcance válido: ${def.validScopes.join(', ')}`,
        );
      }
    }
    const codes = grants.map((g) => g.permissionCode);
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException('Cada permissão só pode aparecer uma vez na lista');
    }
  }

  protected toPublicProfile(profile: ProfileWithCount) {
    return {
      id: profile.id,
      name: profile.name,
      isProtected: profile.isProtected,
      userCount: profile._count.users,
      grants: profile.permissions.map((p) => ({ permissionCode: p.permissionCode, scope: p.scope })),
    };
  }
}
