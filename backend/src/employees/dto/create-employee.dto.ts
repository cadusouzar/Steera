import { ContractType } from '@prisma/client';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString() @MinLength(1) @MaxLength(255) fullName!: string;
  @IsString() @MinLength(11) cpf!: string;
  @IsString() @MinLength(1) roleId!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() @MaxLength(2000) address?: string;
  @IsEnum(ContractType) contractType!: ContractType;
  @IsDateString() admissionDate!: string;
  @IsString() @MinLength(1) @MaxLength(255) department!: string;
  @IsNumber() @Min(0.01) @Max(100_000_000) baseValue!: number;
  @IsInt() @Min(1) @Max(31) paymentDueDay!: number;
  @IsOptional() @IsBoolean() payOnLastBusinessDay?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) bankDetails?: string;
  @IsOptional() @IsBoolean() salaryRecurrenceEnabled?: boolean;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}
