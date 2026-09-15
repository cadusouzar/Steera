import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Teto de 20MB pro tamanho máximo de anexo configurável. O default do schema é 5MB
// (FilesService.MAX_SIZE_BYTES, usado quando nada sobrepõe) — este é o limite de quanto uma
// empresa/um superior pode SUBIR esse valor pela configuração. Achado na revisão final de
// 15/09/2026: sem um @Max, qualquer valor (ex.: 2GB) era aceito, e desde que a configuração virou
// editável por superior de time (não só pela empresa inteira) isso passou a ser um vetor barato de
// esgotar disco/memória do servidor de upload.
const MAX_CONFIGURABLE_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

export class UpdateTimeTrackingSettingsDto {
  @IsOptional() @IsBoolean() requirePhoto?: boolean;
  @IsOptional() @IsBoolean() requireLocation?: boolean;
  // Quando true, localização ausente/imprecisa vira PENDING_REVIEW em vez de
  // bloquear a batida (ver comentário do model no schema.prisma).
  @IsOptional() @IsBoolean() allowLocationException?: boolean;
  @IsOptional() @IsBoolean() allowExtraPeriods?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_CONFIGURABLE_ATTACHMENT_SIZE_BYTES) maxAttachmentSizeBytes?: number;
  @IsOptional() @IsString() managerId?: string;
}
