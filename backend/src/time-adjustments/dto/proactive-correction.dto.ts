import { TimeAdjustmentType, TimeEventType } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// `reason` é obrigatório aqui (nunca opcional como em CreateAdjustmentRequestDto) — uma correção
// proativa não tem o próprio funcionário justificando; quem faz a correção sempre precisa
// registrar o motivo, sem exceção.
export class ProactiveCorrectionDto {
  @IsISO8601() targetDate!: string;
  @IsOptional() @IsString() relatedEventId?: string;
  @IsEnum(TimeAdjustmentType) type!: TimeAdjustmentType;
  @IsOptional() @IsEnum(TimeEventType) requestedEventType?: TimeEventType;
  @IsOptional() @IsISO8601() requestedTime?: string;
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
