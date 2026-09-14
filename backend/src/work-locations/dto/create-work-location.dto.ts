import { IsBoolean, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateWorkLocationDto {
  @IsString() @MinLength(1) name!: string;
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsInt() @Min(1) radiusMeters!: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
