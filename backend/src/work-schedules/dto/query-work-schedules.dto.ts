import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryWorkSchedulesDto {
  @IsOptional() @IsString() employeeId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
