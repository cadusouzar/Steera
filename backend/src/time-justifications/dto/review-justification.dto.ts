import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// `reviewNote` é opcional no DTO (aprovação aceita sem nota) mas o service exige um valor
// não-vazio para reject() — mesmo padrão de ReviewAdjustmentRequestDto.
export class ReviewJustificationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) reviewNote?: string;
}
