import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('RH_CARGOS')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @RequirePermission('cargos.gerenciar')
  @Post()
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @RequirePermission('cargos.ver')
  @Get()
  findAll(@Query() query: QueryRolesDto) {
    return this.rolesService.findAll(query);
  }

  @RequirePermission('cargos.ver')
  @Get('active')
  findActive() {
    return this.rolesService.findActive();
  }

  @RequirePermission('cargos.ver')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @RequirePermission('cargos.gerenciar')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @RequirePermission('cargos.gerenciar')
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.rolesService.deactivate(id);
  }

  @RequirePermission('cargos.gerenciar')
  @Patch(':id/reactivate')
  reactivate(@Param('id') id: string) {
    return this.rolesService.reactivate(id);
  }
}
