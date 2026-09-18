import { IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class CreateRoleDto {
  @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @IsString() @MinLength(1) @MaxLength(255) department!: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX, { message: 'colorHex deve estar no formato #RRGGBB' }) colorHex?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
