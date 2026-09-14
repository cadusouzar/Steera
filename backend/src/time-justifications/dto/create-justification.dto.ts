import { JustificationType } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

// De propósito SEM employeeId/companyId — sempre resolvidos no servidor via
// TimeManagementAuthService.resolveOwnEmployee(user). Também de propósito SEM nenhum campo de
// CID/diagnóstico — atestado é tratado como dado sensível de saúde (LGPD); `description` é texto
// livre não-estruturado, nunca um campo dedicado a diagnóstico.
export class CreateJustificationDto {
  @IsEnum(JustificationType) type!: JustificationType;
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsISO8601() relatedDate?: string;
  @IsOptional() @IsISO8601() periodStart?: string;
  @IsOptional() @IsISO8601() periodEnd?: string;
}
