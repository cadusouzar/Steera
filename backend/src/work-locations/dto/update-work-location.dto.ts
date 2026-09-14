import { IsBoolean, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateWorkLocationDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsInt() @Min(1) radiusMeters?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
