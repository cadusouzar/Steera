import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateEmployeeWarningDto {
  @IsDateString() occurredAt!: string;
  @IsString() @MinLength(1) reason!: string;
}
