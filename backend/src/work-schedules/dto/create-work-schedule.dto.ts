import {
  ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength,
} from 'class-validator';

// "HH:mm", 00-23:00-59, sempre com zero à esquerda (rejeita "9:00", "25:00").
export const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateWorkScheduleDto {
  @IsString() @MinLength(1) employeeId!: string;
  @IsString() @MinLength(1) name!: string;

  // 0=domingo..6=sábado (ver comentário do model no schema.prisma). Sem
  // repetição — @ArrayUnique.
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekDays!: number[];

  @Matches(HHMM_REGEX, { message: 'expectedStartTime deve estar no formato HH:mm' })
  expectedStartTime!: string;

  @Matches(HHMM_REGEX, { message: 'expectedEndTime deve estar no formato HH:mm' })
  expectedEndTime!: string;

  @IsOptional() @IsInt() @Min(0) breakMinutes?: number;
  @IsInt() @Min(1) dailyMinutes!: number;
  @IsInt() @Min(1) weeklyMinutes!: number;
  @IsOptional() @IsInt() @Min(0) toleranceMinutes?: number;
  @IsOptional() @IsBoolean() allowOvertime?: boolean;
  @IsOptional() @IsInt() @Min(1) maxOvertimeMinutesPerDay?: number;
  @IsOptional() @IsBoolean() nightShift?: boolean;

  @IsDateString() validFrom!: string;
  @IsOptional() @IsDateString() validTo?: string;
}
