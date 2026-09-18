import { EmployeeRecurringPaymentStatus } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateEmployeeRecurringPaymentDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) description?: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100_000_000) amount?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) dueDay?: number;
  @IsOptional() @IsEnum(EmployeeRecurringPaymentStatus) status?: EmployeeRecurringPaymentStatus;
}
