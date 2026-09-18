import { IsBoolean, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateWorkLocationDto {
  @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
  @IsInt() @Min(1) radiusMeters!: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
