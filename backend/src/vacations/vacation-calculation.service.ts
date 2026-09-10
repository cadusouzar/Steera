import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ContractType } from '@prisma/client';
import { startOfToday } from '../common/date.util';

// Escopo desta etapa (aprovado explicitamente): regra básica de 30 dias por
// período aquisitivo de 12 meses, proporcional para período incompleto, mais
// o adicional constitucional de 1/3 (CF/88 art. 7º XVII). NÃO cobre: faltas
// injustificadas (CLT art. 130), abono pecuniário, adiantamento de 13º,
// INSS/IRRF, férias vencidas/em dobro (CLT art. 137) nem fracionamento em
// períodos — pedir esses casos deve responder 422 de forma explícita, nunca
// calcular um valor inventado.
export const VACATION_RULE_VERSION =
  '2026-09-10 — regra básica CLT (30 dias/ano, CLT art. 129) + adicional constitucional de 1/3 (CF/88 art. 7º XVII); ' +
  'faltas, abono, 13º, INSS/IRRF, dobro e fracionamento não suportados nesta etapa.';

export interface VacationCalculationInput {
  contractType: ContractType;
  admissionDate: Date;
  baseValue: number;
  daysAlreadyTaken: number;
  referenceDate?: Date;
}

export interface VacationCalculationResult {
  ruleVersion: string;
  admissionDate: Date;
  monthsWorked: number;
  acquisitivePeriodStart: Date;
  acquisitivePeriodEnd: Date;
  acquisitionComplete: boolean;
  totalAcquiredDays: number;
  proportionalDays: number;
  balanceDays: number;
  oneThirdBonus: number;
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

@Injectable()
export class VacationCalculationService {
  calculate(input: VacationCalculationInput): VacationCalculationResult {
    if (input.contractType !== 'CLT') {
      throw new UnprocessableEntityException(
        `Cálculo de férias CLT não se aplica ao vínculo ${input.contractType}.`,
      );
    }

    const referenceDate = input.referenceDate ?? startOfToday();
    const monthsWorked =
      (referenceDate.getUTCFullYear() - input.admissionDate.getUTCFullYear()) * 12 +
      (referenceDate.getUTCMonth() - input.admissionDate.getUTCMonth());

    const completedPeriods = Math.floor(monthsWorked / 12);
    const acquisitivePeriodStart = addMonths(input.admissionDate, completedPeriods * 12);
    const acquisitivePeriodEnd = addMonths(acquisitivePeriodStart, 12);

    const totalAcquiredDays = completedPeriods * 30;
    const currentPeriodMonths = monthsWorked % 12;
    const proportionalDays = Math.floor((currentPeriodMonths / 12) * 30);
    const balanceDays = Math.max(totalAcquiredDays - input.daysAlreadyTaken, 0);
    const dailyRate = input.baseValue / 30;
    const oneThirdBonus = Number(((dailyRate * balanceDays) / 3).toFixed(2));

    return {
      ruleVersion: VACATION_RULE_VERSION,
      admissionDate: input.admissionDate,
      monthsWorked,
      acquisitivePeriodStart,
      acquisitivePeriodEnd,
      acquisitionComplete: completedPeriods >= 1,
      totalAcquiredDays,
      proportionalDays,
      balanceDays,
      oneThirdBonus,
    };
  }
}
