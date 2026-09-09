import { ClientStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() @MinLength(1) contact?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
}
