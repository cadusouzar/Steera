import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { CreateProfileDto } from './dto/create-profile.dto';
import { ReassignAndDeleteDto } from './dto/reassign-and-delete.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfilesService } from './profiles.service';

// Permissões por ação e alcance (Task 6, 27/09/2026): Perfis seguem a permissão
// `usuarios.gerenciar` (a mesma área "Usuários e perfis"), não mais o papel ADMIN — declarada no
// nível da classe, vale pra toda rota, leituras inclusive.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('usuarios.gerenciar')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  // Catálogo global de permissões (nome/descrição/alcances válidos) — nunca escopado por empresa,
  // é dado fixo do sistema. Rota fixa 'catalog' precisa vir ANTES de ':id' neste arquivo.
  @Get('catalog')
  getCatalog() {
    return PERMISSION_CATALOG;
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.findAllForCompany(user.companyId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profiles.findOne(user.companyId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProfileDto) {
    return this.profiles.create(user.companyId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user.companyId, id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profiles.remove(user.companyId, id);
  }

  @Post(':id/reassign-and-delete')
  @HttpCode(204)
  reassignAndDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReassignAndDeleteDto,
  ) {
    return this.profiles.reassignAndDelete(user.companyId, id, dto, user);
  }
}
