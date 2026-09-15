import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateTimeTrackingSettingsDto {
  @IsOptional() @IsBoolean() requirePhoto?: boolean;
  @IsOptional() @IsBoolean() requireLocation?: boolean;
  // Quando true, localização ausente/imprecisa vira PENDING_REVIEW em vez de
  // bloquear a batida (ver comentário do model no schema.prisma).
  @IsOptional() @IsBoolean() allowLocationException?: boolean;
  @IsOptional() @IsBoolean() allowExtraPeriods?: boolean;
  @IsOptional() @IsInt() @Min(1) maxAttachmentSizeBytes?: number;
  @IsOptional() @IsString() managerId?: string;
}
