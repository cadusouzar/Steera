import { IsEmail, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() @MinLength(1) contact?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
