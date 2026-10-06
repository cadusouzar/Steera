import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class FinancialSummaryQueryDto {
  @IsOptional() @IsString() topDefaulters?: string;
  @IsOptional() @IsISO8601({ strict: true }, { message: 'Data de início do período inválida.' }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }, { message: 'Data de fim do período inválida.' }) to?: string;
}
