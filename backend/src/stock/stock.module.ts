import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { FilesModule } from '../files/files.module';
import { ProductTaxonomyService } from './product-taxonomy.service';
import { ProductTrashService } from './product-trash.service';
import { ProductsService } from './products.service';
import {
  StockBrandsController, StockCategoriesController, StockMovementsController, StockProductsController, StockReportsController,
} from './stock.controllers';
import { StockMovementsService } from './stock-movements.service';
import { StockReportsService } from './stock-reports.service';

// Estoque v1 (08/10/2026). StockMovementsService é exportado de propósito: integrações futuras
// (vendas, compras) devem registrar movimentações por ele (applyLocked/entry/exit), nunca alterando
// saldo de produto direto.
@Module({
  imports: [CompanyModule, CustomFieldsModule, FilesModule],
  controllers: [
    StockProductsController, StockMovementsController, StockCategoriesController, StockBrandsController, StockReportsController,
  ],
  providers: [ProductsService, StockMovementsService, ProductTrashService, ProductTaxonomyService, StockReportsService],
  exports: [StockMovementsService],
})
export class StockModule {}
