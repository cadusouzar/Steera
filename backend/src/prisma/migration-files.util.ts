import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Nomes de pasta de migration do Prisma começam com um timestamp (ex.: "20260909225101_init"),
// então a ordenação lexicográfica de string já é a ordem cronológica correta — sem precisar
// parsear nada. migration_lock.toml (arquivo, não pasta) fica na raiz de prisma/migrations/ e
// nunca é uma migration — excluído explicitamente, nunca por acidente de nomenclatura.
export function listMigrationNames(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
    .sort();
}

export function readMigrationSql(migrationsDir: string, migrationName: string): string {
  return readFileSync(join(migrationsDir, migrationName, 'migration.sql'), 'utf-8');
}
