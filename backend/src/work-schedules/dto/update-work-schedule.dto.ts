import {
  ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength,
} from 'class-validator';
import { HHMM_REGEX } from './create-work-schedule.dto';

export class UpdateWorkScheduleDto {
  @IsOptional() @IsString() @MinLength(1) employeeId?: string;
  @IsOptional() @IsString() @MinLength(1) name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekDays?: number[];

  @IsOptional()
  @Matches(HHMM_REGEX, { message: 'expectedStartTime deve estar no formato HH:mm' })
  expectedStartTime?: string;

  @IsOptional()
  @Matches(HHMM_REGEX, { message: 'expectedEndTime deve estar no formato HH:mm' })
  expectedEndTime?: string;

  @IsOptional() @IsInt() @Min(0) breakMinutes?: number;
  @IsOptional() @IsInt() @Min(1) dailyMinutes?: number;
  @IsOptional() @IsInt() @Min(1) weeklyMinutes?: number;
  @IsOptional() @IsInt() @Min(0) toleranceMinutes?: number;
  @IsOptional() @IsBoolean() allowOvertime?: boolean;
  @IsOptional() @IsInt() @Min(1) maxOvertimeMinutesPerDay?: number;
  @IsOptional() @IsBoolean() nightShift?: boolean;

  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
}
