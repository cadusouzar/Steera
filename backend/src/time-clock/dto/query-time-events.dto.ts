import { Type } from 'class-transformer';
import { TimeEventValidationStatus } from '@prisma/client';
import { IsEnum, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';

export class QueryTimeEventsDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsEnum(TimeEventValidationStatus) status?: TimeEventValidationStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
