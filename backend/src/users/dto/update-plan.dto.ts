import { IsEnum } from 'class-validator';

export class UpdatePlanDto {
  @IsEnum(['BASICO', 'PRO', 'EMPRESARIAL']) planTier!: 'BASICO' | 'PRO' | 'EMPRESARIAL';
}
