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
