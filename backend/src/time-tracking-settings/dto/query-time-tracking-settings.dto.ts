import { IsOptional, IsString } from 'class-validator';

export class QueryTimeTrackingSettingsDto {
  @IsOptional() @IsString() managerId?: string;
}
