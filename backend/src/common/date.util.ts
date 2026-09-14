// `dueDate` (e demais colunas `@db.Date`) são sempre lidas pelo Prisma como
// UTC midnight — todo valor "só data" manuseado no app é normalizado para UTC
// midnight também. Usar meia-noite local faria um valor com vencimento "hoje"
// comparar como atrasado em qualquer fuso a oeste de UTC (ex.: UTC-3).
export function startOfToday(): Date {
  const now = new Date();
  // getUTCFullYear/getUTCMonth/getUTCDate — não getFullYear/getMonth/getDate
  // (local). Usar os getters locais aqui anularia o comentário acima: o
  // resultado seria "meia-noite UTC do dia local", que diverge do dia UTC
  // real sempre que o fuso local não é UTC e o horário local está perto da
  // virada de dia UTC (ex.: 21h-23h59 no horário de Brasília, UTC-3).
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

// Converte um "dia calendário" (representado como UTC-midnight, ex.: saída de parseDateOnly ou
// Date.UTC(y, m, d)) no instante UTC real da meia-noite LOCAL daquele dia no fuso informado —
// usado pela apuração de ponto (TimeAttendanceCalculationService), onde "dia D" precisa significar
// o dia civil da empresa (Company.timezone), não o dia civil UTC. Sem isso, uma empresa em
// UTC-3 teria toda batida entre 21h-23h59 (horário local) contada no dia civil ERRADO (o dia UTC
// seguinte já teria começado). Implementado via Intl.DateTimeFormat (sem nova dependência): mede
// quanto o "relógio de parede" do fuso está deslocado do instante UTC de teste, e aplica esse
// deslocamento de volta.
export function localMidnightUtc(dateOnlyUtc: Date, timeZone: string): Date {
  const utcGuess = Date.UTC(dateOnlyUtc.getUTCFullYear(), dateOnlyUtc.getUTCMonth(), dateOnlyUtc.getUTCDate());
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(utcGuess))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const wallClockAsIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = wallClockAsIfUtc - utcGuess;
  return new Date(utcGuess - offsetMs);
}
