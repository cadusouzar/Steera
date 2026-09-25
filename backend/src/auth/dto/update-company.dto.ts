import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../common/trim.transform';
import { BRAZILIAN_STATES } from './register.dto';

// PATCH /auth/me/company (só ADMIN) — mesmos campos e regras do cadastro, MENOS o que nunca muda
// depois de criada a empresa: tipo de pessoa (PJ/PF) e documento (trocar o documento é trocar de
// empresa). Substituição completa: o frontend sempre manda todos os campos. A obrigatoriedade do
// nome fantasia depende do tipo da empresa (PJ), que não vem no corpo — conferida no service.
export class UpdateCompanyDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(255) legalName!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(255) tradeName?: string;
  @IsString() @MaxLength(20) phone!: string;
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter 8 dígitos' }) zipCode!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(255) street!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(20) number!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(255) complement?: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(255) district!: string;
  @Trim() @IsString() @MinLength(1) @MaxLength(255) city!: string;
  @IsIn(BRAZILIAN_STATES) state!: string;
}
