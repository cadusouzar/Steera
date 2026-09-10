import { IsBoolean } from 'class-validator';

export class DeactivateClientDto {
  @IsBoolean()
  includeInRevenueReport!: boolean;
}
