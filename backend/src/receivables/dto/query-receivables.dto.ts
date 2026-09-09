import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class QueryReceivablesDto {
  @IsOptional() @IsIn(['pending', 'paid', 'overdue']) status?: 'pending' | 'paid' | 'overdue';
  @IsOptional() @IsIn(['dueDate_asc', 'dueDate_desc']) sort?: 'dueDate_asc' | 'dueDate_desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
