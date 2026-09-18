import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateEmployeeWarningDto {
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) reason?: string;
}
