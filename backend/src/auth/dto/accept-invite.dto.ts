import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsLegalAcceptance } from './accept-legal.dto';

// POST /auth/accept-invite — mesmas regras do ResetPasswordDto (token 20-200, senha 8-128); só o
// nome do campo de senha muda (`password`: é a primeira senha da pessoa, não uma "nova").
export class AcceptInviteDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  // LGPD (07/10/2026): o convidado aceita os Termos/Política ao definir a primeira senha.
  @IsLegalAcceptance() acceptLegal!: boolean;
}
