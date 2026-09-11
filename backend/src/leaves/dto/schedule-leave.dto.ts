import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ScheduleLeaveDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsInt() @Min(1) daysCount!: number;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
}
