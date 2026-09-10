import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateEmployeeWarningDto {
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() @MinLength(1) reason?: string;
}
