import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateHolidayDto {
  @IsDateString() date!: string;
  @IsString() @MinLength(1) name!: string;
}
