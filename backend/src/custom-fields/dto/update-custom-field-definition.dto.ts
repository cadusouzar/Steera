import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateCustomFieldDefinitionDto {
  @IsOptional() @IsString() @MinLength(1) displayName?: string;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsString() defaultValue?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() configuration?: { options?: string[] };
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
}
