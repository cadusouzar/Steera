import { BadRequestException } from '@nestjs/common';

export interface ReportPeriod {
  from: Date;
  to: Date;
  // Fuso IANA do navegador (opcional); sem ele vale o Company.timezone.
  timeZone?: string;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1000;

// Período do relatório financeiro (06/10/2026). `from`/`to` já chegam validados como ISO 8601 pelo
// FinancialSummaryQueryDto; aqui ficam só as regras que envolvem os dois juntos. Sem nenhum dos dois,
// o relatório é o de sempre (sem período) — a Visão Geral depende disso.
export function parseReportPeriod(from?: string, to?: string, tz?: string): ReportPeriod | undefined {
  if (from === undefined && to === undefined) return undefined;
  if (from === undefined || to === undefined) {
    throw new BadRequestException('Informe o início e o fim do período.');
  }
  if (tz !== undefined && !isValidTimeZone(tz)) {
    throw new BadRequestException('Fuso horário inválido.');
  }
  const period: ReportPeriod = { from: new Date(from), to: new Date(to), ...(tz !== undefined ? { timeZone: tz } : {}) };
  if (period.from.getTime() >= period.to.getTime()) {
    throw new BadRequestException('O início do período precisa ser antes do fim.');
  }
  if (period.to.getTime() - period.from.getTime() > MAX_PERIOD_MS) {
    throw new BadRequestException('O período pode ter no máximo 366 dias.');
  }
  return period;
}
