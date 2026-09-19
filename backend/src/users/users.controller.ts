import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssignProfileDto } from './dto/assign-profile.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('companies/me/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findAllForCompany(user.companyId);
  }

  @Roles('ADMIN')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.users.create(user.companyId, dto);
  }

  // block()/unblock() no service não retornam corpo (ao contrário do resto do
  // codebase, que sempre devolve o recurso atualizado) — sem @HttpCode(204),
  // o Nest manda 200 com corpo vazio, e `res.json()` no frontend (src/lib/api.ts)
  // quebra com "Unexpected end of JSON input" (descoberto durante verificação
  // manual da Task 11). 204 é a resposta correta pra uma ação sem corpo.
  @Roles('ADMIN')
  @Patch(':id/block')
  @HttpCode(204)
  block(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.block(user.companyId, id);
  }

  @Roles('ADMIN')
  @Patch(':id/unblock')
  @HttpCode(204)
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.unblock(user.companyId, id);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.remove(user.companyId, id);
  }

  @Roles('ADMIN')
  @Patch(':id/reset-password')
  resetPassword(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.resetPassword(user.companyId, id);
  }

  @Roles('ADMIN')
  @Patch(':id/profile')
  @HttpCode(204)
  assignProfile(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AssignProfileDto) {
    return this.users.assignProfile(user.companyId, id, dto.profileId);
  }
}
