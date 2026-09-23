import { IsNotEmpty, IsString } from 'class-validator';

export class ReassignAndDeleteDto {
  @IsString() @IsNotEmpty() targetProfileId!: string;
}
