import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { buildPermissionDeniedMessage } from '../auth/permission-labels';
import { AdjustmentMovementDto, EntryMovementDto, ExitMovementDto, QueryMovementsDto, ReverseMovementDto } from './dto/movement.dto';
import { CreateProductDto, QueryProductsDto, TaxonomyNameDto, UpdateProductDto } from './dto/product.dto';
import { ProductTaxonomyService, TaxonomyKind } from './product-taxonomy.service';
import { ProductTrashService } from './product-trash.service';
import { ProductsService } from './products.service';
import { StockMovementsService } from './stock-movements.service';
import { StockReportsService } from './stock-reports.service';

// Estoque v1 — módulo OPERACOES (plano Pro/Empresarial) + permissões `estoque.*` por ação.
// `@types/multer` não está instalado: mesmo formato mínimo dos outros controllers com upload.
interface UploadedImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

function sendCsv(res: Response, filename: string, body: Buffer) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('OPERACOES')
@Controller('stock/products')
export class StockProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly movements: StockMovementsService,
    private readonly trashService: ProductTrashService,
  ) {}

  @RequirePermission('estoque.ver')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryProductsDto) {
    return this.products.findAll(user, query);
  }

  @RequirePermission('estoque.ver')
  @Get('by-code/:code')
  findByCode(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.products.findByCode(user, code);
  }

  @RequirePermission('estoque.lixeira.gerenciar')
  @Get('trash')
  findTrash(@CurrentUser() user: AuthenticatedUser) {
    return this.products.findTrash(user, (companyId) => this.trashService.processExpiredTrash(companyId));
  }

  @RequirePermission('estoque.ver')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.findOne(user, id);
  }

  @RequirePermission('estoque.produtos.gerenciar')
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.products.create(user, dto);
  }

  @RequirePermission('estoque.produtos.gerenciar')
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(user, id, dto);
  }

  @RequirePermission('estoque.produtos.gerenciar')
  @Patch(':id/deactivate')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.setStatus(user, id, 'INACTIVE');
  }

  @RequirePermission('estoque.produtos.gerenciar')
  @Patch(':id/reactivate')
  reactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.setStatus(user, id, 'ACTIVE');
  }

  @RequirePermission('estoque.produtos.gerenciar')
  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }))
  setPhoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @UploadedFile() photo: UploadedImage | undefined) {
    return this.products.setPhoto(user, id, photo);
  }

  @RequirePermission('estoque.produtos.gerenciar')
  @Delete(':id/photo')
  removePhoto(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.removePhoto(user, id);
  }

  @RequirePermission('estoque.lixeira.gerenciar')
  @Patch(':id/trash')
  trash(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.trash(user, id);
  }

  @RequirePermission('estoque.lixeira.gerenciar')
  @Patch(':id/restore')
  restore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.restore(user, id);
  }

  @RequirePermission('estoque.movimentar')
  @Post(':id/entries')
  entry(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: EntryMovementDto) {
    return this.movements.entry(user, id, dto);
  }

  @RequirePermission('estoque.movimentar')
  @Post(':id/exits')
  exit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ExitMovementDto) {
    return this.movements.exit(user, id, dto);
  }

  @RequirePermission('estoque.ajustar')
  @Post(':id/adjustments')
  adjust(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AdjustmentMovementDto) {
    return this.movements.adjust(user, id, dto);
  }
}

@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('OPERACOES')
@Controller('stock/movements')
export class StockMovementsController {
  constructor(private readonly movements: StockMovementsService) {}

  @RequirePermission('estoque.ver')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryMovementsDto) {
    return this.movements.findAll(user, query);
  }

  @RequirePermission('estoque.ver')
  @Get('performers')
  performers(@CurrentUser() user: AuthenticatedUser) {
    return this.movements.listPerformers(user);
  }

  @RequirePermission('estoque.ver')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.movements.findOne(user, id);
  }

  @RequirePermission('estoque.estornar')
  @Post(':id/reverse')
  reverse(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReverseMovementDto) {
    return this.movements.reverse(user, id, dto);
  }
}

function taxonomyController(kind: TaxonomyKind, path: string) {
  @UseGuards(ModulesGuard, PermissionsGuard)
  @RequireModule('OPERACOES')
  @Controller(path)
  class TaxonomyController {
    constructor(readonly taxonomy: ProductTaxonomyService) {}

    @RequirePermission('estoque.ver')
    @Get()
    list(@CurrentUser() user: AuthenticatedUser) {
      return this.taxonomy.list(user, kind);
    }

    @RequirePermission('estoque.produtos.gerenciar')
    @Post()
    create(@CurrentUser() user: AuthenticatedUser, @Body() dto: TaxonomyNameDto) {
      return this.taxonomy.create(user, kind, dto.name);
    }

    @RequirePermission('estoque.produtos.gerenciar')
    @Patch(':id')
    rename(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: TaxonomyNameDto) {
      return this.taxonomy.rename(user, kind, id, dto.name);
    }

    @RequirePermission('estoque.produtos.gerenciar')
    @Delete(':id')
    @HttpCode(204)
    remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
      return this.taxonomy.remove(user, kind, id);
    }
  }
  return TaxonomyController;
}

export const StockCategoriesController = taxonomyController('category', 'stock/categories');
export const StockBrandsController = taxonomyController('brand', 'stock/brands');

@UseGuards(ModulesGuard, PermissionsGuard)
@RequireModule('OPERACOES')
@Controller('stock/reports')
export class StockReportsController {
  constructor(private readonly reports: StockReportsService) {}

  @RequirePermission('estoque.ver')
  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.overview(user);
  }

  @RequirePermission('estoque.ver')
  @Get('replenishment')
  replenishment(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.replenishment(user);
  }

  @RequirePermission('estoque.ver')
  @Get('period-summary')
  periodSummary(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.periodSummary(user, from, to);
  }

  // Exportar exige `estoque.exportar` E `estoque.ver` (o guard tem semântica OU, então a segunda
  // checagem é feita aqui). Custos continuam saindo só com `estoque.custos.ver`.
  private assertCanView(user: AuthenticatedUser) {
    if (!('estoque.ver' in (user.permissions ?? {}))) {
      throw new ForbiddenException({ statusCode: 403, code: 'PERMISSION_REQUIRED', message: buildPermissionDeniedMessage('estoque.ver') });
    }
  }

  @RequirePermission('estoque.exportar')
  @Get('export/position.csv')
  async positionCsv(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryProductsDto, @Res() res: Response) {
    this.assertCanView(user);
    sendCsv(res, `estoque-posicao-${today()}.csv`, await this.reports.positionCsv(user, query));
  }

  @RequirePermission('estoque.exportar')
  @Get('export/movements.csv')
  async movementsCsv(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryMovementsDto, @Res() res: Response) {
    this.assertCanView(user);
    sendCsv(res, `estoque-movimentacoes-${today()}.csv`, await this.reports.movementsCsv(user, query));
  }

  @RequirePermission('estoque.exportar')
  @Get('export/replenishment.csv')
  async replenishmentCsv(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    this.assertCanView(user);
    sendCsv(res, `estoque-reposicao-${today()}.csv`, await this.reports.replenishmentCsv(user));
  }
}
