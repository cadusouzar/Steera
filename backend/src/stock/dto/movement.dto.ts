import { StockMovementReason, StockMovementType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Trim } from '../../common/trim.transform';

// Quantidades e custos chegam como string ("1,5" ou "1.5") ou número; a validação de casas
// decimais/unidade é feita no serviço (parseQuantity/parseMoney), que conhece a unidade do produto.
const NUMERIC = (v: unknown) => (typeof v === 'number' ? String(v) : v);

export const ENTRY_REASONS: StockMovementReason[] = ['MANUAL_ENTRY', 'PURCHASE_RECEIVED', 'CUSTOMER_RETURN', 'OTHER_ENTRY'];
export const EXIT_REASONS: StockMovementReason[] = [
  'MANUAL_EXIT', 'INTERNAL_CONSUMPTION', 'LOSS', 'DAMAGE', 'SUPPLIER_RETURN', 'OTHER_EXIT',
];

class MovementBaseDto {
  // Gerado pelo navegador ao abrir o formulário: reenviar o mesmo pedido (clique duplo, rede
  // instável) devolve a movimentação já gravada em vez de criar outra.
  @IsUUID()
  requestId!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  documentRef?: string;
}

export class EntryMovementDto extends MovementBaseDto {
  @Transform(({ value }) => NUMERIC(value))
  @IsString()
  @IsNotEmpty()
  quantity!: string;

  @Transform(({ value }) => NUMERIC(value))
  @IsString()
  @IsNotEmpty()
  unitCost!: string;

  @IsIn(ENTRY_REASONS)
  reason!: StockMovementReason;
}

export class ExitMovementDto extends MovementBaseDto {
  @Transform(({ value }) => NUMERIC(value))
  @IsString()
  @IsNotEmpty()
  quantity!: string;

  @IsIn(EXIT_REASONS)
  reason!: StockMovementReason;
}

export class AdjustmentMovementDto {
  @IsUUID()
  requestId!: string;

  @Transform(({ value }) => NUMERIC(value))
  @IsString()
  @IsNotEmpty()
  countedQuantity!: string;

  // Saldo que a pessoa viu ao abrir a contagem. Se mudou até a confirmação, a API recusa (409) e
  // devolve o saldo atual para revisão.
  @Transform(({ value }) => NUMERIC(value))
  @IsString()
  @IsNotEmpty()
  expectedBalance!: string;

  // Só exigido quando o ajuste é positivo e o saldo atual é zero (sem custo médio para usar).
  @IsOptional()
  @Transform(({ value }) => NUMERIC(value))
  @IsString()
  unitCost?: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Informe a justificativa do ajuste' })
  @MaxLength(2000)
  notes!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  documentRef?: string;
}

export class ReverseMovementDto {
  @IsUUID()
  requestId!: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Informe a justificativa do estorno' })
  @MaxLength(2000)
  notes!: string;
}

export class QueryMovementsDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(Object.values(StockMovementType)) type?: StockMovementType;
  @IsOptional() @IsIn(Object.values(StockMovementReason)) reason?: StockMovementReason;
  @IsOptional() @IsString() performedByUserId?: string;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) page?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(200) pageSize?: number;
}
