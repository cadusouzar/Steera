import { ProductStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { Trim } from '../../common/trim.transform';
import { STOCK_SITUATIONS, StockSituation } from '../stock-situation.util';
import { STOCK_UNIT_CODES } from '../stock-units';

const NUMERIC = (v: unknown) => (typeof v === 'number' ? String(v) : v);
// `null` explícito limpa um campo opcional na edição; string vazia também.
const NULLABLE_NUMERIC = (v: unknown) => (v === '' || v === null ? null : NUMERIC(v));
const NULLABLE_TEXT = (v: unknown) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v);

class ProductFieldsDto {
  @IsOptional()
  @Transform(({ value }) => NULLABLE_TEXT(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  barcode?: string | null;

  @IsOptional()
  @Transform(({ value }) => NULLABLE_TEXT(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  brandId?: string | null;

  @IsOptional()
  @Transform(({ value }) => NULLABLE_TEXT(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  location?: string | null;

  @IsOptional()
  @Transform(({ value }) => NULLABLE_NUMERIC(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  referenceCost?: string | null;

  @IsOptional()
  @Transform(({ value }) => NULLABLE_NUMERIC(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  salePrice?: string | null;

  @IsOptional()
  @Transform(({ value }) => NULLABLE_NUMERIC(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  minStock?: string | null;

  @IsOptional()
  @Transform(({ value }) => NULLABLE_NUMERIC(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  targetStock?: string | null;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class CreateProductDto extends ProductFieldsDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do produto' })
  @MaxLength(255)
  name!: string;

  // Vazio/ausente = gerar automaticamente (PRD-000001, PRD-000002...).
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @IsOptional()
  @IsIn(STOCK_UNIT_CODES)
  unit?: string;

  @IsOptional()
  @IsIn(Object.values(ProductStatus))
  status?: ProductStatus;

  // Só na criação: gera a movimentação de saldo inicial na mesma transação.
  @IsOptional()
  @Transform(({ value }) => NULLABLE_NUMERIC(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  initialQuantity?: string | null;

  @IsOptional()
  @Transform(({ value }) => NULLABLE_NUMERIC(value))
  @ValidateIf((_, v) => v !== null)
  @IsString()
  initialUnitCost?: string | null;
}

export class UpdateProductDto extends ProductFieldsDto {
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do produto' })
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Informe o SKU' })
  @MaxLength(60)
  sku?: string;

  @IsOptional()
  @IsIn(STOCK_UNIT_CODES)
  unit?: string;
}

export type ProductView = 'current' | 'deleted' | 'all';

export class QueryProductsDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(Object.values(ProductStatus)) status?: ProductStatus;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
  @IsOptional() @IsIn(STOCK_SITUATIONS) situation?: StockSituation;
  // current = fora da lixeira/arquivo (padrão); deleted = só excluídos/arquivados; all = tudo.
  @IsOptional() @IsIn(['current', 'deleted', 'all']) view?: ProductView;
  // Para seletores de nova operação: só produtos que podem ser movimentados.
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() selectable?: boolean;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class TaxonomyNameDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome' })
  @MaxLength(80)
  name!: string;
}
