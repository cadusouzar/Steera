import { IsString } from 'class-validator';

export class AssignProfileDto {
  @IsString() profileId!: string;
}
