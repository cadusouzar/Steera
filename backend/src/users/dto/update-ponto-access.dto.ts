import { IsBoolean } from 'class-validator';

export class UpdatePontoAccessDto {
  @IsBoolean() hasFullPontoAccess!: boolean;
}
