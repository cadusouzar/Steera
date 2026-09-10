import { ClientStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryClientsDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  // "Listagem operacional" — exclui só quem está na lixeira
  // (status=INACTIVE && includeInRevenueReport=false). Independente de
  // `status`: um cliente inativo mantido no relatório (includeInRevenueReport
  // =true) continua aparecendo mesmo com excludeTrashed=true.
  @IsOptional() @Transform(({ value }) => value === 'true') @IsBoolean() excludeTrashed?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 20;
}
