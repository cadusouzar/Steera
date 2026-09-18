import { IsDateString, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateReceivableDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) description?: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100_000_000) amount?: number;
  @IsOptional() @IsDateString() dueDate?: string;
}
