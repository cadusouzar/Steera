import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ScheduleVacationDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsInt() @Min(1) daysCount!: number;
  @IsOptional() @IsString() notes?: string;
}
