import { IsDateString, IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateEmployeePaymentDto {
  @IsString() @MinLength(1) @MaxLength(2000) description!: string;
  @IsNumber() @Min(0.01) @Max(100_000_000) amount!: number;
  @IsDateString() dueDate!: string;
}
