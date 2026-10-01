import { IsString, MaxLength, MinLength } from 'class-validator';

// Token = 32 bytes aleatórios em base64url (ver UserTokensService.issue) — sempre 43 caracteres,
// a janela 20-200 só existe pra rejeitar cedo um valor claramente malformado (nunca a fonte de
// verdade de validade/expiração, que é sempre `consume()`).
export class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
  // Mesmo piso/teto de RegisterDto/ChangePasswordDto/AcceptInviteDto; a força (zxcvbn) é conferida
  // em AuthService.resetPassword, antes de gastar o token.
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}
