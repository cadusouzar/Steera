import { IsInt, IsNumber, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateEmployeeRecurringPaymentDto {
  @IsString() @MinLength(1) description!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsInt() @Min(1) @Max(31) dueDay!: number;
}
