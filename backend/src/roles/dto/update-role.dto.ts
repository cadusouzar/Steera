import { IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { HEX_COLOR_REGEX } from './create-role.dto';

export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) department?: string;
  @IsOptional() @Matches(HEX_COLOR_REGEX, { message: 'colorHex deve estar no formato #RRGGBB' }) colorHex?: string;
  @IsOptional() @IsString() description?: string;
}
