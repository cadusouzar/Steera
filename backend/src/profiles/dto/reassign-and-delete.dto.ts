import { IsString } from 'class-validator';

export class ReassignAndDeleteDto {
  @IsString() targetProfileId!: string;
}
