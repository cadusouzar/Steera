import { AppModule as AppModuleEnum } from '@prisma/client';
import { IsArray, IsEnum } from 'class-validator';

// Edição de um login já existente (17/09/2026) — hoje só `modules` é editável. `email`/`role`
// continuam definidos uma única vez na criação (ver CLAUDE.md/DECISOES-TECNICAS): mudar o e-mail
// de um login mexeria com a identidade de autenticação em si, e mudar o role teria implicações em
// hasFullPontoAccess/limite de plano que não foram pedidas — fora de escopo por ora, não um
// esquecimento.
export class UpdateUserDto {
  @IsArray() @IsEnum(AppModuleEnum, { each: true }) modules!: AppModuleEnum[];
}
