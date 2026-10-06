// Períodos do relatório financeiro (06/10/2026). Tudo no horário local do navegador: os atalhos são
// dias de calendário; quem fecha o caixa depois da meia-noite usa "Personalizado" com hora.

export type PeriodPreset = 'today' | 'yesterday' | 'thisMonth' | 'lastMonth' | 'custom';

export interface ReportPeriod {
  from: Date;
  to: Date;
}

const startOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 0, 0, 0, 0);
const endOfDay = (y: number, m: number, d: number) => new Date(y, m, d, 23, 59, 59, 999);

export function presetPeriod(preset: Exclude<PeriodPreset, 'custom'>, now: Date = new Date()): ReportPeriod {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (preset) {
    case 'today':
      return { from: startOfDay(y, m, d), to: endOfDay(y, m, d) };
    case 'yesterday':
      return { from: startOfDay(y, m, d - 1), to: endOfDay(y, m, d - 1) };
    case 'thisMonth':
      return { from: startOfDay(y, m, 1), to: endOfDay(y, m + 1, 0) };
    case 'lastMonth':
      return { from: startOfDay(y, m - 1, 1), to: endOfDay(y, m, 0) };
  }
}

// Datas no formato do <input type="date"> (YYYY-MM-DD) e horas do <input type="time"> (HH:MM).
// O fim inclui o minuto escolhido inteiro: "até 01:00" cobre 01:00:00 a 01:00:59.999.
// Devolve null se algum campo estiver vazio/inválido ou se o início não for antes do fim.
export function customPeriod(startDate: string, startTime: string, endDate: string, endTime: string): ReportPeriod | null {
  const parse = (date: string, time: string, end: boolean) => {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const tm = /^(\d{2}):(\d{2})$/.exec(time);
    if (!dm || !tm) return null;
    return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), end ? 59 : 0, end ? 999 : 0);
  };
  const from = parse(startDate, startTime, false);
  const to = parse(endDate, endTime, true);
  if (!from || !to || from.getTime() >= to.getTime()) return null;
  return { from, to };
}

export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatPeriod(p: ReportPeriod): string {
  return `${dateTimeFormat.format(p.from)} até ${dateTimeFormat.format(p.to)}`;
}
