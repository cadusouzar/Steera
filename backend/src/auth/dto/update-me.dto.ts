import { IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../common/trim.transform';

// PATCH /auth/me — só o nome do próprio login. E-mail é a identidade do login e não é editável.
export class UpdateMeDto {
  @Trim() @IsString() @MinLength(1) @MaxLength(255) name!: string;
}
