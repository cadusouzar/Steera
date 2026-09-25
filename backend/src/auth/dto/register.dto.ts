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
  @IsString() @MinLength(1) @MaxLength(255) legalName!: string;
  @ValidateIf((o: RegisterDto) => o.personType === 'PJ' || o.tradeName !== undefined)
  @IsString() @MinLength(1) @MaxLength(255) tradeName?: string;
  @IsString() @MaxLength(20) phone!: string;
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter 8 dígitos' }) zipCode!: string;
  @IsString() @MinLength(1) @MaxLength(255) street!: string;
  @IsString() @MinLength(1) @MaxLength(20) number!: string;
  @IsOptional() @IsString() @MaxLength(255) complement?: string;
  @IsString() @MinLength(1) @MaxLength(255) district!: string;
  @IsString() @MinLength(1) @MaxLength(255) city!: string;
  @IsIn(BRAZILIAN_STATES) state!: string;
  @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}
