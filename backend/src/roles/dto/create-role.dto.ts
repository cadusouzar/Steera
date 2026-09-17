import { IsObject, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export class CreateRoleDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) department!: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX, { message: 'colorHex deve estar no formato #RRGGBB' }) colorHex?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
