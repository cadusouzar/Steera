import { IsString, MinLength } from 'class-validator';

export class CustomFieldOptionQueryDto {
  @IsString() @MinLength(1) option!: string;
}
