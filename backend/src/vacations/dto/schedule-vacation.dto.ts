import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ScheduleVacationDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsInt() @Min(1) @Max(365) daysCount!: number;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  // Quando true, ignora o teto fixo de 30 dias somados de férias não-canceladas
  // (VacationSchedulesService.schedule). Default falsy quando omitido.
  @IsOptional() @IsBoolean() exceptionAuthorized?: boolean;
}
