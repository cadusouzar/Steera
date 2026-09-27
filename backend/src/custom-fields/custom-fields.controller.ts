import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CustomFieldDefinitionsService } from './custom-field-definitions.service';
import { CustomFieldValuesService } from './custom-field-values.service';
import { CustomFieldEntityKey } from './custom-field-entities';
import { CreateCustomFieldDefinitionDto } from './dto/create-custom-field-definition.dto';
import { CustomFieldEntityQueryDto } from './dto/custom-field-entity-query.dto';
import { CustomFieldOptionQueryDto } from './dto/custom-field-option-query.dto';
import { UpdateCustomFieldDefinitionDto } from './dto/update-custom-field-definition.dto';

// Permissões por ação e alcance (Task 6, 27/09/2026): as definições seguem a permissão
// `campos-personalizados.gerenciar` do perfil, não mais o papel ADMIN.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(
    private readonly definitions: CustomFieldDefinitionsService,
    private readonly values: CustomFieldValuesService,
  ) {}

  @RequirePermission('campos-personalizados.gerenciar')
  @Get()
  findAll(@Query() query: CustomFieldEntityQueryDto) {
    return this.definitions.findAll(query.entity as CustomFieldEntityKey);
  }

  // Sem @RequirePermission: qualquer usuário autenticado precisa disso pra renderizar o formulário de
  // criação/edição de Cliente/Cargo/Funcionário.
  @Get('active')
  findActive(@Query() query: CustomFieldEntityQueryDto) {
    return this.values.getActiveDefinitions(query.entity as CustomFieldEntityKey);
  }

  @RequirePermission('campos-personalizados.gerenciar')
  @Post()
  create(@Body() dto: CreateCustomFieldDefinitionDto) {
    return this.definitions.create(dto);
  }

  @RequirePermission('campos-personalizados.gerenciar')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomFieldDefinitionDto) {
    return this.definitions.update(id, dto);
  }

  @RequirePermission('campos-personalizados.gerenciar')
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.definitions.deactivate(id);
  }

  @RequirePermission('campos-personalizados.gerenciar')
  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.definitions.reactivate(id);
  }

  @RequirePermission('campos-personalizados.gerenciar')
  @Get(':id/filled-count')
  async filledCount(@Param('id') id: string) {
    return { count: await this.definitions.countFilledValues(id) };
  }

  @RequirePermission('campos-personalizados.gerenciar')
  @Get(':id/option-usage')
  async optionUsage(@Param('id') id: string, @Query() query: CustomFieldOptionQueryDto) {
    return { count: await this.definitions.countOptionUsage(id, query.option) };
  }

  @RequirePermission('campos-personalizados.gerenciar')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.definitions.remove(id);
  }
}
