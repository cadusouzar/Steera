import { IsString, MaxLength, MinLength } from 'class-validator';

// Corpo de POST /auth/verify-email. Token = 32 bytes aleatórios em base64url (43 caracteres, ver
// UserTokensService.issue) — a janela 20-200 só rejeita cedo um valor claramente malformado; quem
// decide validade/expiração é sempre consume().
export class TokenDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
}
