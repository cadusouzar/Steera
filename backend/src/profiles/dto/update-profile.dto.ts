import { Type } from 'class-transformer';
import { IsArray, IsString, Length, ValidateNested } from 'class-validator';
import { ProfileGrantDto } from './create-profile.dto';

export class UpdateProfileDto {
  @IsString() @Length(1, 255) name!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ProfileGrantDto) grants!: ProfileGrantDto[];
}
