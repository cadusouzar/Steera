import { IsOptional, IsString, MinLength } from 'class-validator';

// `reviewNote` é opcional no DTO (aprovação aceita sem nota) mas o service exige um valor
// não-vazio especificamente para reject() — ver TimeAdjustmentsService.reject().
export class ReviewAdjustmentRequestDto {
  @IsOptional() @IsString() @MinLength(1) reviewNote?: string;
}
