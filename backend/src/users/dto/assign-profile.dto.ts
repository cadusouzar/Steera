import { IsNotEmpty, IsString } from 'class-validator';

export class AssignProfileDto {
  @IsString() @IsNotEmpty() profileId!: string;
}
