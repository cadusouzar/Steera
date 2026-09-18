import { IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { HEX_COLOR_REGEX } from './create-role.dto';

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) department?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX, { message: 'colorHex deve estar no formato #RRGGBB' }) colorHex?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
