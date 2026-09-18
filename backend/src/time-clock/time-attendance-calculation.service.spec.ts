import { Test } from '@nestjs/testing';
import { HolidaysService } from '../holidays/holidays.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeAttendanceCalculationService } from './time-attendance-calculation.service';

// `calculateDailySummary` passou a rodar dentro de uma única `runTenantInteractiveTransaction`
// (achado ao vivo 18/09/2026, "Espelho de Ponto demora ~5s") — mesmo padrão de mock já usado em
// time-clock.service.spec.ts/time-adjustments.service.spec.ts: `tx` dentro do callback real é o
// MESMO objeto mock `prisma` deste arquivo, então nenhum teste individual precisa mudar.
jest.mock('../prisma/tenant-rls.extension', () => ({
  runTenantInteractiveTransaction: jest.fn(),
}));

const TZ = 'America/Sao_Paulo'; // UTC-3, sem horário de verão

// Helper: monta um TimeEvent mínimo com serverRecordedAt em UTC a partir de um horário LOCAL
// (America/Sao_Paulo, UTC-3) — deixa os testes lidos em "horário local" sem duplicar a lógica de
// conversão de fuso que o próprio serviço testa.
const localEvent = (type: string, y: number, m: number, d: number, h: number, min = 0) => ({
  id: `${type}-${y}${m}${d}${h}${min}`,
  type,
  serverRecordedAt: new Date(Date.UTC(y, m - 1, d, h + 3, min)), // +3h: converte local (UTC-3) -> UTC
});

describe('TimeAttendanceCalculationService', () => {
  let service: TimeAttendanceCalculationService;
  let prisma: {
    employee: { findUnique: jest.Mock };
    company: { findUnique: jest.Mock };
    workSchedule: { findMany: jest.Mock };
    timeEvent: { findMany: jest.Mock };
    vacationSchedule: { findFirst: jest.Mock };
    leaveSchedule: { findFirst: jest.Mock };
  };
  let holidays: { isHoliday: jest.Mock };

  const schedule = {
    id: 'sched-1',
    employeeId: 'emp-1',
    weekDays: [1, 2, 3, 4, 5], // seg-sex
    dailyMinutes: 480,
    validFrom: new Date(Date.UTC(2026, 0, 1)),
    validTo: null,
  };

  beforeEach(async () => {
    prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue({ companyId: 'company-1' }) },
      company: { findUnique: jest.fn().mockResolvedValue({ timezone: TZ }) },
      workSchedule: { findMany: jest.fn().mockResolvedValue([schedule]) },
      timeEvent: { findMany: jest.fn().mockResolvedValue([]) },
      vacationSchedule: { findFirst: jest.fn().mockResolvedValue(null) },
      leaveSchedule: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    holidays = { isHoliday: jest.fn().mockResolvedValue(false) };
    const { runTenantInteractiveTransaction } = jest.requireMock('../prisma/tenant-rls.extension');
    (runTenantInteractiveTransaction as jest.Mock).mockImplementation((_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma));

    const module = await Test.createTestingModule({
      providers: [
        TimeAttendanceCalculationService,
        { provide: PrismaService, useValue: prisma },
        { provide: HolidaysService, useValue: holidays },
      ],
    }).compile();
    service = module.get(TimeAttendanceCalculationService);
  });

  // 2026-01-05 é uma segunda-feira (dentro de schedule.weekDays).
  const MONDAY = new Date(Date.UTC(2026, 0, 5));

  it('calculates a plain worked period (CLOCK_IN 08:00 -> CLOCK_OUT 17:00 local, no break)', async () => {
    prisma.timeEvent.findMany.mockResolvedValue([
      localEvent('CLOCK_IN', 2026, 1, 5, 8),
      localEvent('CLOCK_OUT', 2026, 1, 5, 17),
    ]);

    const summary = await service.calculateDailySummary('emp-1', MONDAY);

    expect(summary.workedMinutes).toBe(9 * 60);
    expect(summary.expectedMinutes).toBe(480);
    expect(summary.balanceMinutes).toBe(9 * 60 - 480);
    expect(summary.hasOpenJourney).toBe(false);
  });

  // Achado ao vivo (18/09/2026, "Espelho de Ponto demora ~5s pra carregar"): cada leitura de tabela
  // de TENANT (eventos/escala/férias/afastamento) fora de uma transação explícita pagava sua
  // PRÓPRIA mini-transação — agrupadas agora numa única `runTenantInteractiveTransaction` por dia.
  // `employee`/`company` ficam de propósito FORA dela: `Employee` é tenant mas `Company` é CENTRAL,
  // e uma query ESTRUTURADA (`tx.company...`) pra uma tabela central dentro de uma transação de
  // tenant falha em runtime ("tabela não existe") — o fallback de schema de uma transação de tenant
  // só vale pra SQL bruto, nunca pra chamadas tipadas do Prisma (achado ao vivo, corrigindo uma
  // tentativa anterior deste mesmo fix). `isHoliday()` também fica de propósito FORA (usa o client
  // central do `HolidaysService`, e `Holiday` tem RLS que depende de `app.current_company_id` — rodar
  // por baixo do `insideExplicitTx` ambiental pularia esse set_config e esconderia feriados
  // customizados da empresa).
  it('batches events/schedule/vacation/leave (tenant tables) into a single transaction per day; employee/company (central) and isHoliday() stay outside it', async () => {
    const { runTenantInteractiveTransaction } = jest.requireMock('../prisma/tenant-rls.extension');
    (runTenantInteractiveTransaction as jest.Mock).mockClear();

    await service.calculateDailySummary('emp-1', MONDAY);

    expect(runTenantInteractiveTransaction).toHaveBeenCalledTimes(1);
    expect(holidays.isHoliday).toHaveBeenCalledWith(MONDAY);
  });

  it('discounts multiple break intervals from worked time', async () => {
    prisma.timeEvent.findMany.mockResolvedValue([
      localEvent('CLOCK_IN', 2026, 1, 5, 8),
      localEvent('BREAK_START', 2026, 1, 5, 10),
      localEvent('BREAK_END', 2026, 1, 5, 10, 15),
      localEvent('BREAK_START', 2026, 1, 5, 12),
      localEvent('BREAK_END', 2026, 1, 5, 13),
      localEvent('CLOCK_OUT', 2026, 1, 5, 17),
    ]);

    const summary = await service.calculateDailySummary('emp-1', MONDAY);

    // 9h de jornada - (15min + 60min) de intervalo = 465min
    expect(summary.breakMinutes).toBe(75);
    expect(summary.workedMinutes).toBe(9 * 60 - 75);
  });

  it('flags an incomplete journey (CLOCK_IN with no CLOCK_OUT anywhere in the 48h lookahead) as hasOpenJourney, not counted as worked', async () => {
    prisma.timeEvent.findMany.mockResolvedValue([localEvent('CLOCK_IN', 2026, 1, 5, 8)]);

    const summary = await service.calculateDailySummary('emp-1', MONDAY);

    expect(summary.hasOpenJourney).toBe(true);
    expect(summary.workedMinutes).toBe(0);
  });

  // Achado ao vivo (18/09/2026): CLOCK_IN 00:30, BREAK_START 01:00, BREAK_END 02:00, sem CLOCK_OUT
  // ainda — antes deste fix, workedMinutes dava -60 (breakMs de 60min descontado de um workedMs
  // que nunca chegava a ser somado, já que só era creditado no fechamento por CLOCK_OUT). Só se
  // aplica a uma jornada aberta que pertence a HOJE — por isso o relógio do teste é congelado.
  describe('an open journey belonging to today', () => {
    const REAL_NOW = new Date(Date.UTC(2026, 8, 18, 5, 0)); // 2026-09-18 02:00 local (America/Sao_Paulo, UTC-3)
    const TODAY = new Date(Date.UTC(2026, 8, 18));

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(REAL_NOW);
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('never goes negative when a completed break sits inside a journey still open today — nets elapsed time since CLOCK_IN minus the completed break', async () => {
      prisma.timeEvent.findMany.mockResolvedValue([
        localEvent('CLOCK_IN', 2026, 9, 18, 0, 30),
        localEvent('BREAK_START', 2026, 9, 18, 1, 0),
        localEvent('BREAK_END', 2026, 9, 18, 2, 0),
      ]);

      const summary = await service.calculateDailySummary('emp-1', TODAY);

      // Decorrido desde o CLOCK_IN (00:30) até "agora" (02:00) = 90min; menos 60min de intervalo
      // completo (01:00-02:00) = 30min líquidos.
      expect(summary.workedMinutes).toBe(30);
      expect(summary.breakMinutes).toBe(60);
      expect(summary.hasOpenJourney).toBe(true);
    });

    it('freezes the live count at the break-start instant while a break is still in progress (not still ticking during the break itself)', async () => {
      prisma.timeEvent.findMany.mockResolvedValue([
        localEvent('CLOCK_IN', 2026, 9, 18, 0, 30),
        localEvent('BREAK_START', 2026, 9, 18, 1, 0),
      ]);

      const summary = await service.calculateDailySummary('emp-1', TODAY);

      // Decorrido desde o CLOCK_IN (00:30) até o INÍCIO do intervalo em andamento (01:00) = 30min
      // — não continua contando durante o intervalo, mesmo com "agora" (02:00) bem depois.
      expect(summary.workedMinutes).toBe(30);
      expect(summary.hasOpenJourney).toBe(true);
    });
  });

  it('sums an EXTRA_IN/EXTRA_OUT pair into extraMinutes, never into workedMinutes', async () => {
    prisma.timeEvent.findMany.mockResolvedValue([
      localEvent('CLOCK_IN', 2026, 1, 5, 8),
      localEvent('CLOCK_OUT', 2026, 1, 5, 17),
      localEvent('EXTRA_IN', 2026, 1, 5, 18),
      localEvent('EXTRA_OUT', 2026, 1, 5, 19, 30),
    ]);

    const summary = await service.calculateDailySummary('emp-1', MONDAY);

    expect(summary.extraMinutes).toBe(90);
    expect(summary.workedMinutes).toBe(9 * 60);
  });

  it('correctly pairs a night shift crossing midnight (CLOCK_IN 22:00 local, CLOCK_OUT 06:00 local next day) — credited to the day it opened, not flagged as an open journey', async () => {
    // CLOCK_OUT recorded on 2026-01-06 (the next calendar day) — fetched via the 48h lookahead
    // buffer, but credited to Monday 2026-01-05 because that's when the pair OPENED.
    prisma.timeEvent.findMany.mockResolvedValue([
      localEvent('CLOCK_IN', 2026, 1, 5, 22),
      localEvent('CLOCK_OUT', 2026, 1, 6, 6),
    ]);

    const summary = await service.calculateDailySummary('emp-1', MONDAY);

    expect(summary.hasOpenJourney).toBe(false);
    expect(summary.workedMinutes).toBe(8 * 60);
    // The CLOCK_OUT itself (dated the next civil day) is not part of THIS day's displayed events.
    expect(summary.events).toHaveLength(1);
    expect(summary.events[0].type).toBe('CLOCK_IN');
  });

  it('zeroes expectedMinutes on a holiday', async () => {
    holidays.isHoliday.mockResolvedValue(true);
    const summary = await service.calculateDailySummary('emp-1', MONDAY);
    expect(summary.expectedMinutes).toBe(0);
    expect(summary.isHoliday).toBe(true);
  });

  it('zeroes expectedMinutes during a scheduled vacation, even on a non-holiday', async () => {
    prisma.vacationSchedule.findFirst.mockResolvedValue({ id: 'vac-1' });
    const summary = await service.calculateDailySummary('emp-1', MONDAY);
    expect(summary.expectedMinutes).toBe(0);
    expect(summary.isOnVacationOrLeave).toBe(true);
  });

  it('zeroes expectedMinutes during a scheduled leave (afastamento), even on a non-holiday', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({ id: 'leave-1' });
    const summary = await service.calculateDailySummary('emp-1', MONDAY);
    expect(summary.expectedMinutes).toBe(0);
    expect(summary.isOnVacationOrLeave).toBe(true);
  });

  it('zeroes expectedMinutes on a day of the week not covered by the WorkSchedule (weekDays filter), even though the schedule is otherwise in its valid range', async () => {
    // 2026-01-10 é um sábado — fora de schedule.weekDays ([1..5]).
    const SATURDAY = new Date(Date.UTC(2026, 0, 10));
    const summary = await service.calculateDailySummary('emp-1', SATURDAY);
    expect(summary.expectedMinutes).toBe(0);
  });

  it('resolves the day/night boundary using the company timezone, not raw UTC (a punch at 21:30 local, 00:30 UTC the next day, is still credited to the local calendar day)', async () => {
    // 21:30 local em 2026-01-05 = 00:30 UTC em 2026-01-06. Um cálculo ingênuo por fronteira UTC
    // atribuiria esse evento ao dia UTC seguinte; o correto é permanecer em 2026-01-05 (local).
    prisma.timeEvent.findMany.mockResolvedValue([
      localEvent('CLOCK_IN', 2026, 1, 5, 8),
      localEvent('CLOCK_OUT', 2026, 1, 5, 21, 30),
    ]);

    const summary = await service.calculateDailySummary('emp-1', MONDAY);

    expect(summary.workedMinutes).toBe(13 * 60 + 30);
    expect(summary.events).toHaveLength(2);
  });

  describe('getScheduleForDate — three tiers (individual -> team default -> company default)', () => {
    const individual = {
      id: 'individual',
      employeeId: 'emp-1',
      managerId: null,
      weekDays: [1],
      dailyMinutes: 240,
      validFrom: new Date(Date.UTC(2026, 0, 1)),
      validTo: null,
    };
    const teamDefault = {
      id: 'team-default',
      employeeId: null,
      managerId: 'manager-1',
      weekDays: [1],
      dailyMinutes: 300,
      validFrom: new Date(Date.UTC(2026, 0, 1)),
      validTo: null,
    };
    const companyDefault = {
      id: 'company-default',
      employeeId: null,
      managerId: null,
      weekDays: [1],
      dailyMinutes: 400,
      validFrom: new Date(Date.UTC(2026, 0, 1)),
      validTo: null,
    };

    it('prefers an individual schedule over a team-default one', async () => {
      prisma.workSchedule.findMany.mockReset();
      prisma.workSchedule.findMany.mockResolvedValueOnce([individual]); // individual tier already matches

      const summary = await service.calculateDailySummary('emp-1', MONDAY);

      expect(summary.expectedMinutes).toBe(240);
      // Individual matched — never even queries the team/company tiers.
      expect(prisma.workSchedule.findMany).toHaveBeenCalledTimes(1);
    });

    it('falls back to the team-default schedule when no individual one matches', async () => {
      prisma.employee.findUnique.mockResolvedValue({ companyId: 'company-1', managerId: 'manager-1' });
      prisma.workSchedule.findMany.mockReset();
      prisma.workSchedule.findMany
        .mockResolvedValueOnce([]) // individual: no match
        .mockResolvedValueOnce([teamDefault]); // team (direct manager): match

      const summary = await service.calculateDailySummary('emp-1', MONDAY);

      expect(summary.expectedMinutes).toBe(300);
    });

    it('falls back to the company-wide default schedule when neither individual nor team match', async () => {
      prisma.employee.findUnique.mockResolvedValue({ companyId: 'company-1', managerId: 'manager-1' });
      prisma.workSchedule.findMany.mockReset();
      prisma.workSchedule.findMany
        .mockResolvedValueOnce([]) // individual: no match
        .mockResolvedValueOnce([]) // team: no match
        .mockResolvedValueOnce([companyDefault]); // company-wide: match

      const summary = await service.calculateDailySummary('emp-1', MONDAY);

      expect(summary.expectedMinutes).toBe(400);
    });

    it('results in expectedMinutes: 0 when none of the three tiers has a matching schedule', async () => {
      prisma.employee.findUnique.mockResolvedValue({ companyId: 'company-1', managerId: 'manager-1' });
      prisma.workSchedule.findMany.mockReset();
      prisma.workSchedule.findMany.mockResolvedValue([]); // every tier empty

      const summary = await service.calculateDailySummary('emp-1', MONDAY);

      expect(summary.expectedMinutes).toBe(0);
    });

    it('skips the team-tier query entirely when the employee has no managerId (no chain propagation)', async () => {
      prisma.employee.findUnique.mockResolvedValue({ companyId: 'company-1', managerId: null });
      prisma.workSchedule.findMany.mockReset();
      prisma.workSchedule.findMany
        .mockResolvedValueOnce([]) // individual: no match
        .mockResolvedValueOnce([companyDefault]); // company-wide: match (2nd call, since team was skipped)

      const summary = await service.calculateDailySummary('emp-1', MONDAY);

      expect(summary.expectedMinutes).toBe(400);
      expect(prisma.workSchedule.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('calculateMonthlySummary', () => {
    it('sums daily totals across the month and never generates a day after today', async () => {
      jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 3, 12))); // "today" = 2026-01-03
      prisma.timeEvent.findMany.mockResolvedValue([
        localEvent('CLOCK_IN', 2026, 1, 5, 8),
        localEvent('CLOCK_OUT', 2026, 1, 5, 17),
      ]);

      const result = await service.calculateMonthlySummary('emp-1', 2026, 1);

      expect(result.days).toHaveLength(3); // dias 1, 2 e 3 de janeiro apenas
      expect(result.days.every((d) => new Date(d.date).getTime() <= Date.now())).toBe(true);
      jest.useRealTimers();
    });
  });
});
