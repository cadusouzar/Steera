import { Injectable } from '@nestjs/common';
import { TimeEvent } from '@prisma/client';
import { localMidnightUtc } from '../common/date.util';
import { HolidaysService } from '../holidays/holidays.service';
import { PrismaService } from '../prisma/prisma.service';

export interface DailySummary {
  date: string;
  workedMinutes: number;
  expectedMinutes: number;
  breakMinutes: number;
  extraMinutes: number;
  balanceMinutes: number; // workedMinutes - expectedMinutes
  isHoliday: boolean;
  isOnVacationOrLeave: boolean;
  hasOpenJourney: boolean; // CLOCK_IN aberto por este dia sem CLOCK_OUT correspondente, nem mesmo no buffer de +48h
  events: TimeEvent[];
}

export interface MonthlyTotals {
  workedMinutes: number;
  expectedMinutes: number;
  extraMinutes: number;
  balanceMinutes: number;
}

export interface MonthlySummary {
  days: DailySummary[];
  totals: MonthlyTotals;
}

// Buffer técnico de busca (não é uma regra trabalhista, nem um teto de jornada): só existe pra dar
// à consulta alcance suficiente para encontrar o CLOCK_OUT/BREAK_END/EXTRA_OUT de uma jornada que
// começou no dia D mas só fecha depois da meia-noite local (turno noturno). O crédito de cada par
// ainda é decidido só pelo horário do evento de ABERTURA (ver pairEventsOpenedWithin) — nunca pelo
// de fechamento — então um evento de fechamento capturado por este buffer não "vaza" pra conta do
// dia seguinte.
const CLOSING_EVENT_LOOKAHEAD_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class TimeAttendanceCalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holidays: HolidaysService,
  ) {}

  // Pareia por TIPO em sequência (CLOCK_IN->CLOCK_OUT, BREAK_START->BREAK_END,
  // EXTRA_IN->EXTRA_OUT), nunca por posição no array — corrige o bug real do mock anterior.
  // `windowStart`/`windowEnd` delimitam quais eventos, pelo horário de ABERTURA do par, pertencem
  // a este dia — um par cujo evento de abertura cai fora de [windowStart, windowEnd) não credita
  // tempo aqui, mesmo que apareça na lista `sorted` (ela pode conter eventos de fechamento de até
  // 48h depois, buscados só pra permitir encontrar o fechamento de uma jornada noturna).
  private pairEvents(sorted: TimeEvent[], windowStart: Date, windowEnd: Date) {
    let workedMs = 0;
    let breakMs = 0;
    let extraMs = 0;
    let openClockIn: TimeEvent | null = null;
    let openBreakStart: TimeEvent | null = null;
    let openExtraIn: TimeEvent | null = null;

    const opensThisDay = (e: TimeEvent) => e.serverRecordedAt >= windowStart && e.serverRecordedAt < windowEnd;

    for (const e of sorted) {
      if (e.type === 'CLOCK_IN') openClockIn = e;
      if (e.type === 'CLOCK_OUT' && openClockIn) {
        if (opensThisDay(openClockIn)) workedMs += e.serverRecordedAt.getTime() - openClockIn.serverRecordedAt.getTime();
        openClockIn = null;
      }
      if (e.type === 'BREAK_START') openBreakStart = e;
      if (e.type === 'BREAK_END' && openBreakStart) {
        if (opensThisDay(openBreakStart)) breakMs += e.serverRecordedAt.getTime() - openBreakStart.serverRecordedAt.getTime();
        openBreakStart = null;
      }
      if (e.type === 'EXTRA_IN') openExtraIn = e;
      if (e.type === 'EXTRA_OUT' && openExtraIn) {
        if (opensThisDay(openExtraIn)) extraMs += e.serverRecordedAt.getTime() - openExtraIn.serverRecordedAt.getTime();
        openExtraIn = null;
      }
    }

    // "Jornada aberta" é reportado só quando o CLOCK_IN que abriu este dia segue sem CLOCK_OUT
    // mesmo depois de olhar todo o buffer de 48h — nunca para um turno noturno que fecha
    // normalmente no dia seguinte (esse caso já foi corretamente pareado e creditado acima).
    const hasOpenJourney = openClockIn !== null && opensThisDay(openClockIn);

    return {
      workedMinutes: Math.round((workedMs - breakMs) / 60000),
      breakMinutes: Math.round(breakMs / 60000),
      extraMinutes: Math.round(extraMs / 60000),
      hasOpenJourney,
    };
  }

  // Busca a WorkSchedule vigente NA DATA (validFrom <= data <= validTo OU validTo nulo) E cujo
  // weekDays inclua o dia da semana de `date` — sem o filtro de weekDays, um dia de folga dentro do
  // período de vigência (ex.: sábado de uma escala "seg-sex") seria incorretamente contado como
  // "esperado", gerando saldo negativo todo fim de semana.
  private async getScheduleForDate(employeeId: string, date: Date) {
    const candidates = await this.prisma.workSchedule.findMany({
      where: { employeeId, validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] },
      orderBy: { validFrom: 'desc' },
    });
    const localDayOfWeek = date.getUTCDay(); // `date` já é um "dia calendário" (UTC-midnight-encoded) — getUTCDay() dá o dia da semana pretendido, sem depender do fuso da empresa.
    return candidates.find((s) => s.weekDays.includes(localDayOfWeek)) ?? null;
  }

  async calculateDailySummary(employeeId: string, date: Date): Promise<DailySummary> {
    // `Employee` não tem relação `company` declarada no schema (só o escalar `companyId`) — busca
    // em duas etapas.
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { companyId: true } });
    const company = employee ? await this.prisma.company.findUnique({ where: { id: employee.companyId }, select: { timezone: true } }) : null;
    const timezone = company?.timezone ?? 'America/Sao_Paulo';

    // Janela real do dia civil da empresa (fuso-aware) — não UTC bruto (ver localMidnightUtc).
    const windowStart = localMidnightUtc(date, timezone);
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
    // Busca com alcance estendido (+48h) só pra alcançar o fechamento de um turno noturno; o
    // crédito de cada par continua decidido por windowStart/windowEnd em pairEvents.
    const fetchEnd = new Date(windowStart.getTime() + CLOSING_EVENT_LOOKAHEAD_MS);

    const [fetchedEvents, schedule, isHoliday, vacation, leave] = await Promise.all([
      this.prisma.timeEvent.findMany({
        where: { employeeId, serverRecordedAt: { gte: windowStart, lt: fetchEnd } },
        orderBy: { serverRecordedAt: 'asc' },
      }),
      this.getScheduleForDate(employeeId, date),
      this.holidays.isHoliday(date),
      this.prisma.vacationSchedule.findFirst({
        where: { employeeId, startDate: { lte: date }, endDate: { gte: date }, status: { not: 'CANCELLED' } },
      }),
      this.prisma.leaveSchedule.findFirst({
        where: { employeeId, startDate: { lte: date }, endDate: { gte: date }, status: { not: 'CANCELLED' } },
      }),
    ]);

    const paired = this.pairEvents(fetchedEvents, windowStart, windowEnd);
    const expectedMinutes = schedule && !isHoliday && !vacation && !leave ? schedule.dailyMinutes : 0;
    // `events` exibido pro chamador é só o que de fato pertence a este dia civil (para exibição em
    // timesheet) — o fechamento de um turno noturno capturado pelo buffer de +48h aparece na
    // consulta do dia em que foi de fato registrado, não duplicado aqui.
    const eventsThisDay = fetchedEvents.filter((e) => e.serverRecordedAt >= windowStart && e.serverRecordedAt < windowEnd);

    return {
      date: date.toISOString().slice(0, 10),
      workedMinutes: paired.workedMinutes,
      expectedMinutes,
      breakMinutes: paired.breakMinutes,
      extraMinutes: paired.extraMinutes,
      balanceMinutes: paired.workedMinutes - expectedMinutes,
      isHoliday,
      isOnVacationOrLeave: !!vacation || !!leave,
      hasOpenJourney: paired.hasOpenJourney,
      events: eventsThisDay,
    };
  }

  async calculateMonthlySummary(employeeId: string, year: number, month: number): Promise<MonthlySummary> {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const days: DailySummary[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(Date.UTC(year, month - 1, d));
      if (date.getTime() > Date.now()) break; // não gera dias futuros
      days.push(await this.calculateDailySummary(employeeId, date));
    }
    const totals = days.reduce<MonthlyTotals>(
      (acc, d) => ({
        workedMinutes: acc.workedMinutes + d.workedMinutes,
        expectedMinutes: acc.expectedMinutes + d.expectedMinutes,
        extraMinutes: acc.extraMinutes + d.extraMinutes,
        balanceMinutes: acc.balanceMinutes + d.balanceMinutes,
      }),
      { workedMinutes: 0, expectedMinutes: 0, extraMinutes: 0, balanceMinutes: 0 },
    );
    return { days, totals };
  }
}
