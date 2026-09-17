import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomFieldDefinitionsService } from './custom-field-definitions.service';
import { CustomFieldValuesService } from './custom-field-values.service';
import { CustomFieldEntityKey } from './custom-field-entities';
import { CreateCustomFieldDefinitionDto } from './dto/create-custom-field-definition.dto';
import { CustomFieldEntityQueryDto } from './dto/custom-field-entity-query.dto';
import { CustomFieldOptionQueryDto } from './dto/custom-field-option-query.dto';
import { UpdateCustomFieldDefinitionDto } from './dto/update-custom-field-definition.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(
    private readonly definitions: CustomFieldDefinitionsService,
    private readonly values: CustomFieldValuesService,
  ) {}

  @Roles('ADMIN')
  @Get()
  findAll(@Query() query: CustomFieldEntityQueryDto) {
    return this.definitions.findAll(query.entity as CustomFieldEntityKey);
  }

  // Sem @Roles: qualquer usuário autenticado precisa disso pra renderizar o formulário de
  // criação/edição de Cliente/Cargo/Funcionário.
  @Get('active')
  findActive(@Query() query: CustomFieldEntityQueryDto) {
    return this.values.getActiveDefinitions(query.entity as CustomFieldEntityKey);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateCustomFieldDefinitionDto) {
    return this.definitions.create(dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomFieldDefinitionDto) {
    return this.definitions.update(id, dto);
  }

  @Roles('ADMIN')
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.definitions.deactivate(id);
  }

  @Roles('ADMIN')
  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.definitions.reactivate(id);
  }

  @Roles('ADMIN')
  @Get(':id/filled-count')
  async filledCount(@Param('id') id: string) {
    return { count: await this.definitions.countFilledValues(id) };
  }

  @Roles('ADMIN')
  @Get(':id/option-usage')
  async optionUsage(@Param('id') id: string, @Query() query: CustomFieldOptionQueryDto) {
    return { count: await this.definitions.countOptionUsage(id, query.option) };
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.definitions.remove(id);
  }
}
