import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class QueryEmployeePaymentsDto {
  @IsOptional() @IsIn(['pending', 'paid', 'overdue']) status?: 'pending' | 'paid' | 'overdue';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
