import { IsDateString, IsNumber, IsString, Min, MinLength } from 'class-validator';

export class CreateReceivableDto {
  @IsString() @MinLength(1) description!: string;
  @IsNumber() @Min(0.01) amount!: number;
  @IsDateString() dueDate!: string;
}
