import { ForbiddenException } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { findUncoveredGrants, GrantLike, permissionLabels } from '../permissions/grant-coverage.util';

// Permissões por ação e alcance (Task 6, 27/09/2026): Usuários e Perfis passaram a exigir a
// permissão `usuarios.gerenciar` em vez do papel ADMIN, então um login EMPLOYEE com essa permissão
// administra logins. Estas travas fecham as vias pelas quais ele poderia se promover a ADMIN (ou ao
// perfil protegido, com todas as permissões). Chamador ADMIN nunca é afetado. Mesmo corpo de 403 do
// PermissionsGuard (`code: 'PERMISSION_REQUIRED'`), pro frontend tratar do mesmo jeito.
function permissionRequired(message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, code: 'PERMISSION_REQUIRED', message });
}

// Criar um login ADMIN novo (o convite pode ir pra um e-mail do próprio chamador).
export function assertCallerCanCreateRole(role: 'ADMIN' | 'EMPLOYEE', currentUser: AuthenticatedUser): void {
  if (role === 'ADMIN' && currentUser.role !== 'ADMIN') {
    throw permissionRequired('Só um administrador pode criar outro login de administrador.');
  }
}

// Atribuir o perfil protegido (Administrador Geral) — em create(), assignProfile() e no destino de
// ProfilesService.reassignAndDelete().
export function assertCallerCanAssignProfile(
  profile: { name: string; isProtected: boolean },
  currentUser: AuthenticatedUser,
): void {
  if (profile.isProtected && currentUser.role !== 'ADMIN') {
    throw permissionRequired(`Só um administrador pode atribuir o perfil ${profile.name}.`);
  }
}

// Reemitir o convite de um ADMIN ainda INVITED: a resposta devolve o `inviteUrl` cru, então quem
// reemite pode aceitar o convite ele mesmo e virar esse ADMIN. Checado ANTES de emitir token/e-mail.
export function assertCallerCanReissueInvite(target: { role: string }, currentUser: AuthenticatedUser): void {
  if (target.role === 'ADMIN' && currentUser.role !== 'ADMIN') {
    throw permissionRequired('Só um administrador pode reenviar o convite de outro administrador.');
  }
}

// Concessão limitada (28/09/2026): quem gerencia acessos só concede o que o PRÓPRIO perfil também
// tem. Vale pra todo chamador, sem exceção por papel (o Administrador Geral tem tudo e passa). Os
// grants do chamador vêm do BANCO (AuthorizationService.getEffectivePermissions), nunca do JWT —
// um perfil rebaixado há pouco não pode seguir concedendo pelo token antigo. Comparação pura em
// permissions/grant-coverage.util.ts.
type CallerGrants = Record<string, Scope | string | null>;

// Criar/editar um perfil (grants novos) e atribuir um perfil a um login (criar login, trocar perfil,
// destino de reatribuir-e-excluir): lista as permissões que o chamador não tem.
export function assertGrantsWithinCaller(callerGrants: CallerGrants, grants: GrantLike[]): void {
  const uncovered = findUncoveredGrants(callerGrants, grants);
  if (uncovered.length > 0) {
    throw permissionRequired(
      `Você só pode dar permissões que o seu próprio perfil também tem: ${permissionLabels(uncovered)}.`,
    );
  }
}

// Editar, excluir ou reatribuir-e-excluir um perfil cujos grants ATUAIS não estão dentro do chamador.
export function assertProfileWithinCaller(callerGrants: CallerGrants, profileGrants: GrantLike[]): void {
  if (findUncoveredGrants(callerGrants, profileGrants).length > 0) {
    throw permissionRequired('Este perfil tem permissões que o seu perfil não tem. Só quem tem todas elas pode alterá-lo.');
  }
}

// Agir sobre um login (trocar perfil, bloquear, desbloquear, excluir, redefinir senha, reenviar
// convite, vincular funcionário) cujo perfil ATUAL não está dentro do chamador.
export function assertLoginWithinCaller(callerGrants: CallerGrants, loginProfileGrants: GrantLike[]): void {
  if (findUncoveredGrants(callerGrants, loginProfileGrants).length > 0) {
    throw permissionRequired('Este login tem permissões que o seu perfil não tem. Só quem tem todas elas pode alterá-lo.');
  }
}
