import { Trim } from '../../common/trim.transform';
import { IsLegalAcceptance } from './accept-legal.dto';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PR', 'PB', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

// CPF/CNPJ/telefone: formato conferido aqui; checksum/normalização em AuthService.register
// (normalizeDocument/normalizePhone), mesmo padrão do resto do projeto.


export class RegisterDto {
  @IsIn(['PJ', 'PF']) personType!: 'PJ' | 'PF';
  @IsString() @MinLength(11) @MaxLength(18) document!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(255) legalName!: string;
  // Fantasia: obrigatória para PJ; para PF é opcional, e só espaços (vira '' após o trim) conta
  // como "não informada" — o service grava null.
  @Trim()
  @ValidateIf((o: RegisterDto) => o.personType === 'PJ' || (o.tradeName !== undefined && o.tradeName !== ''))
  @IsString() @MinLength(1) @MaxLength(255) tradeName?: string;
  @IsString() @MaxLength(20) phone!: string;
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter 8 dígitos' }) zipCode!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(255) street!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(20) number!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(255) complement?: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(255) district!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(255) city!: string;
  @IsIn(BRAZILIAN_STATES) state!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  // LGPD (07/10/2026): caixa "Li e aceito os Termos de uso e a Política de Privacidade".
  @IsLegalAcceptance() acceptLegal!: boolean;
}
