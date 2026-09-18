import { ContractType } from '@prisma/client';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export class UpdateEmployeeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) fullName?: string;
  @IsOptional() @IsString() @MinLength(11) cpf?: string;
  @IsOptional() @IsString() @MinLength(1) roleId?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() @MaxLength(2000) address?: string;
  @IsOptional() @IsEnum(ContractType) contractType?: ContractType;
  @IsOptional() @IsDateString() admissionDate?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) department?: string;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100_000_000) baseValue?: number;
  @IsOptional() @IsInt() @Min(1) @Max(31) paymentDueDay?: number;
  @IsOptional() @IsBoolean() payOnLastBusinessDay?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) bankDetails?: string;
  @IsOptional() @IsBoolean() salaryRecurrenceEnabled?: boolean;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
