import { ContractType } from '@prisma/client';
import {
  IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString() @MinLength(1) fullName!: string;
  @IsString() @MinLength(11) cpf!: string;
  @IsString() @MinLength(1) roleId!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsEnum(ContractType) contractType!: ContractType;
  @IsDateString() admissionDate!: string;
  @IsString() @MinLength(1) department!: string;
  @IsNumber() @Min(0.01) baseValue!: number;
  @IsInt() @Min(1) @Max(31) paymentDueDay!: number;
  @IsOptional() @IsBoolean() payOnLastBusinessDay?: boolean;
  @IsOptional() @IsString() bankDetails?: string;
  @IsOptional() @IsBoolean() salaryRecurrenceEnabled?: boolean;
  @IsOptional() @IsString() managerId?: string;
}
