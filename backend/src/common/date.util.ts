// `dueDate` (e demais colunas `@db.Date`) são sempre lidas pelo Prisma como
// UTC midnight — todo valor "só data" manuseado no app é normalizado para UTC
// midnight também. Usar meia-noite local faria um valor com vencimento "hoje"
// comparar como atrasado em qualquer fuso a oeste de UTC (ex.: UTC-3).
export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
