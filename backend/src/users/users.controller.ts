import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
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

  @Roles('ADMIN')
  @Patch(':id/block')
  block(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.block(user.companyId, id);
  }

  @Roles('ADMIN')
  @Patch(':id/unblock')
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.unblock(user.companyId, id);
  }

}
