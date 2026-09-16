// Script de checagem manual/periódica (cron externo, ou rodado à mão) — não uma ferramenta paga,
// só os 3 sinais concretos documentados na spec desta correção pra saber, antes de qualquer
// reclamação de cliente, que é hora de aumentar algum limite de conexão.
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  const [{ count: activeConnections }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) as count FROM pg_stat_activity WHERE datname = current_database()`,
  );
  const [{ setting: maxConnections }] = await prisma.$queryRawUnsafe<{ setting: string }[]>(
    `SELECT setting FROM pg_settings WHERE name = 'max_connections'`,
  );
  const usagePercent = (Number(activeConnections) / Number(maxConnections)) * 100;

  console.log(`Conexões ativas no Postgres: ${activeConnections} / ${maxConnections} (${usagePercent.toFixed(1)}%)`);
  if (usagePercent > 80) {
    console.warn('ALERTA: uso de conexões acima de 80% do teto do Postgres — considere aumentar max_connections.');
  }

  console.log('');
  console.log('Para o segundo sinal (PgBouncer SHOW POOLS, cl_waiting > 0), rodar manualmente:');
  console.log('  psql "postgresql://usuario:senha@localhost:6432/pgbouncer" -c "SHOW POOLS;"');
  console.log('  (cl_waiting > 0 com frequência = hora de aumentar TENANT_CLIENT_CACHE_MAX_SIZE ou default_pool_size)');

  console.log('');
  console.log('Para o terceiro sinal (erro de timeout de pool do Prisma), buscar nos logs da aplicação:');
  console.log('  grep -i "P2024" <arquivo-de-log-da-aplicacao>');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Falha ao checar saúde das conexões:', err);
  process.exit(1);
});
