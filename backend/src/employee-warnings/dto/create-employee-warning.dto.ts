import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateEmployeeWarningDto {
  @IsDateString() occurredAt!: string;
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}
