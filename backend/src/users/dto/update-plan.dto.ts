import { IsEnum } from 'class-validator';

export class UpdatePlanDto {
  @IsEnum(['GRATIS', 'BASICO', 'PRO', 'EMPRESARIAL']) planTier!: 'GRATIS' | 'BASICO' | 'PRO' | 'EMPRESARIAL';
}
