import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';

export class UpdateCustomFieldDefinitionDto {
  @IsOptional() @IsString() @MinLength(1) displayName?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  // `null` explícito limpa o valor padrão de volta pra "nenhum" (@ValidateIf pula o @IsString()
  // só nesse caso) — omitir o campo do body inteiro continua significando "não mexer", igual antes.
  @IsOptional() @ValidateIf((o) => o.defaultValue !== null) @IsString() defaultValue?: string | null;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() configuration?: { options?: string[] };
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
}
