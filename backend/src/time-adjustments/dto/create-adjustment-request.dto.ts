import { TimeAdjustmentType, TimeEventType } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// De propósito SEM employeeId/companyId — sempre resolvidos no servidor via
// TimeManagementAuthService.resolveOwnEmployee(user), nunca aceitos do corpo da requisição.
export class CreateAdjustmentRequestDto {
  @IsISO8601() targetDate!: string;
  @IsOptional() @IsString() relatedEventId?: string;
  @IsEnum(TimeAdjustmentType) type!: TimeAdjustmentType;
  @IsOptional() @IsEnum(TimeEventType) requestedEventType?: TimeEventType;
  @IsOptional() @IsISO8601() requestedTime?: string;
  @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
  @IsOptional() @IsString() @MaxLength(2000) justification?: string;
}
