import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AssignProfileDto } from './dto/assign-profile.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

// Permissões por ação e alcance (Task 6, 27/09/2026): toda rota de logins exige a permissão
// `usuarios.gerenciar` do perfil, não mais o papel ADMIN (inclusive a listagem, que antes era livre
// pra qualquer login autenticado). Criar login ADMIN / atribuir perfil protegido continua restrito a
// chamador ADMIN, checado no service (UsersService.assertCallerCanGrant).
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('companies/me/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission('usuarios.gerenciar')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findAllForCompany(user.companyId);
  }

  @RequirePermission('usuarios.gerenciar')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.users.create(user.companyId, dto, user);
  }

  // block()/unblock() no service não retornam corpo (ao contrário do resto do
  // codebase, que sempre devolve o recurso atualizado) — sem @HttpCode(204),
  // o Nest manda 200 com corpo vazio, e `res.json()` no frontend (src/lib/api.ts)
  // quebra com "Unexpected end of JSON input" (descoberto durante verificação
  // manual da Task 11). 204 é a resposta correta pra uma ação sem corpo.
  @RequirePermission('usuarios.gerenciar')
  @Patch(':id/block')
  @HttpCode(204)
  block(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.block(user.companyId, id);
  }

  @RequirePermission('usuarios.gerenciar')
  @Patch(':id/unblock')
  @HttpCode(204)
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.unblock(user.companyId, id);
  }

  @RequirePermission('usuarios.gerenciar')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.remove(user.companyId, id);
  }

  // "Acesso e sessões" (26/09/2026): não devolve mais senha nenhuma — envia um link de redefinição
  // pro e-mail do login (`{ sent }`), ou reenvia o convite se o login ainda é INVITED
  // (`{ sent, inviteUrl }`).
  @RequirePermission('usuarios.gerenciar')
  @Patch(':id/reset-password')
  resetPassword(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.resetPassword(user.companyId, id);
  }

  // Só pra login INVITED (400 "Este login já aceitou o convite." caso contrário). Reemite o token (o
  // link anterior deixa de valer), reenvia e devolve `{ inviteUrl, sent }` pro admin poder copiar o link.
  @RequirePermission('usuarios.gerenciar')
  @Patch(':id/resend-invite')
  resendInvite(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.resendInvite(user.companyId, id);
  }

  @RequirePermission('usuarios.gerenciar')
  @Patch(':id/profile')
  @HttpCode(204)
  assignProfile(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignProfileDto) {
    return this.users.assignProfile(user.companyId, id, dto.profileId, user);
  }
}
