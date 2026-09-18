import { IsEmail, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MaxLength(255) category?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) contact?: string;
  // `null` (nunca string vazia) é como o frontend limpa este campo — @IsOptional() já ignora
  // `null`/`undefined`, mas nunca uma string vazia, que continuaria caindo em @IsEmail() e
  // vazando "email must be an email" (achado durante a auditoria de segurança, 17/09/2026).
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
