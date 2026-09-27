import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

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
