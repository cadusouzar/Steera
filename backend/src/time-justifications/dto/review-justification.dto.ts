import { IsOptional, IsString, MinLength } from 'class-validator';

// `reviewNote` é opcional no DTO (aprovação aceita sem nota) mas o service exige um valor
// não-vazio para reject() — mesmo padrão de ReviewAdjustmentRequestDto (Task 8).
export class ReviewJustificationDto {
  @IsOptional() @IsString() @MinLength(1) reviewNote?: string;
}
