import { PrismaClient } from '@prisma/client';
import { getNationalAndMovableHolidays, getStateHolidays } from '../src/holidays/brazilian-holidays.seed';

const prisma = new PrismaClient();
const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

// NÃO usamos `prisma.holiday.upsert({ where: { scope_state_companyId_date: {...} } })` aqui — o
// tipo gerado pelo Prisma pra essa chave composta (`HolidayScopeStateCompanyIdDateCompoundUniqueInput`)
// exige `state`/`companyId` como `string` não-nulo, mesmo as colunas sendo nullable (não compila com
// `null`), e mais grave: rows NATIONAL/STATE têm sempre `companyId = NULL` (e NATIONAL também tem
// `state = NULL`), e o Postgres NÃO trata dois `NULL` como iguais pra fins de unicidade — um upsert
// via `INSERT ... ON CONFLICT` sobre uma unique constraint com colunas NULL simplesmente não detecta
// o "conflito" na segunda execução e duplicaria a linha em vez de atualizar. Por isso resolvemos
// manualmente (find-then-create-or-update) usando IS NULL explícito no `where`, que funciona
// corretamente com colunas nulas e é o que de fato garante a idempotência exigida (rodar o seed duas
// vezes não deve duplicar nada).
async function upsertHoliday(where: { scope: 'NATIONAL' | 'STATE'; state: string | null; date: Date }, name: string) {
  const existing = await prisma.holiday.findFirst({ where: { ...where, companyId: null } });
  if (existing) {
    if (existing.name !== name) await prisma.holiday.update({ where: { id: existing.id }, data: { name } });
    return;
  }
  await prisma.holiday.create({ data: { ...where, name } });
}

async function main() {
  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4];

  for (const year of years) {
    for (const h of getNationalAndMovableHolidays(year)) {
      await upsertHoliday({ scope: 'NATIONAL', state: null, date: h.date }, h.name);
    }
    for (const uf of UFS) {
      for (const h of getStateHolidays(uf, year)) {
        await upsertHoliday({ scope: 'STATE', state: uf, date: h.date }, h.name);
      }
    }
  }
  console.log(`Feriados semeados para os anos: ${years.join(', ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
