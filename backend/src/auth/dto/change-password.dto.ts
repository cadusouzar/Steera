import { IsString, MaxLength, MinLength } from 'class-validator';

// Força da senha nova (zxcvbn) é conferida em AuthService.changePassword, não aqui — precisa do
// e-mail/nome da pessoa e da empresa como "palavras proibidas".
export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}
