import { IsString, MaxLength, MinLength } from 'class-validator';

// Token = 32 bytes aleatórios em base64url (ver UserTokensService.issue) — sempre 43 caracteres,
// a janela 20-200 só existe pra rejeitar cedo um valor claramente malformado (nunca a fonte de
// verdade de validade/expiração, que é sempre `consume()`).
export class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
  // Mesmo piso de senha do RegisterDto/ChangePasswordDto (@MinLength(8) — nenhum dos dois tem hoje
  // um teto de tamanho). @MaxLength(128) adicionado aqui por consistência com o resto do projeto
  // (toda "Consistência de Validação" trouxe teto pra campo que só tinha piso, ver CLAUDE.md) —
  // registrado no relatório da task como uma pequena divergência em relação aos dois DTOs irmãos,
  // que ficam sem teto por não fazerem parte do escopo desta task.
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}
