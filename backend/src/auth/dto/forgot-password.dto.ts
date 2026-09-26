import { IsEmail, MaxLength } from 'class-validator';

// Sem @Transform trim/lowercase de propósito: LoginDto (o DTO mais próximo em finalidade — também
// só recebe um e-mail pra localizar um User) não normaliza o valor no próprio DTO (a normalização
// que existe hoje, em loginEmailTracker, é só pra formar a CHAVE do throttler por e-mail, nunca
// para a consulta em si) — mantido consistente com esse padrão em vez de introduzir um comportamento
// novo só aqui.
export class ForgotPasswordDto {
  @IsEmail() @MaxLength(255) email!: string;
}
