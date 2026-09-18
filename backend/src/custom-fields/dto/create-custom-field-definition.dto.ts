import { CustomFieldType } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { CUSTOM_FIELD_ENTITY_KEYS } from '../custom-field-entities';

export class CreateCustomFieldDefinitionDto {
  @IsIn(CUSTOM_FIELD_ENTITY_KEYS) entity!: string;
  @IsString() @MinLength(1) @MaxLength(255) displayName!: string;
  @IsIn(Object.values(CustomFieldType)) type!: CustomFieldType;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) defaultValue?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsObject() configuration?: { options?: string[] };
  @IsOptional() @IsInt() @Min(0) displayOrder?: number;
}
