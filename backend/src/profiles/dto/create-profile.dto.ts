import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Scope } from '@prisma/client';

export class ProfileGrantDto {
  @IsString() permissionCode!: string;
  @IsOptional() @IsEnum(Scope) scope?: Scope | null;
}

export class CreateProfileDto {
  @IsString() @Length(1, 255) name!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProfileGrantDto) grants!: ProfileGrantDto[];
}
