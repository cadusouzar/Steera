import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional } from 'class-validator';
import { TimeEventType } from '@prisma/client';

// De propósito SEM campo employeeId/companyId — quem está batendo o próprio ponto é sempre
// resolvido no servidor via TimeManagementAuthService.resolveOwnEmployee(user), nunca aceito do
// corpo da requisição (um campo aqui seria uma forma trivial de um usuário bater ponto em nome de
// outro funcionário da mesma empresa).
export class CreatePunchDto {
  @IsEnum(TimeEventType) type!: TimeEventType;
  @IsOptional() @IsISO8601() deviceReportedAt?: string;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() accuracyMeters?: number;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isMobile?: boolean;
}
