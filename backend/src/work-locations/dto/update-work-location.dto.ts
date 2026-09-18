import { IsBoolean, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateWorkLocationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) name?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsInt() @Min(1) radiusMeters?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
