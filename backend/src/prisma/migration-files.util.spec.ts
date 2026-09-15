import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listMigrationNames, readMigrationSql } from './migration-files.util';

describe('listMigrationNames', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migrations-test-'));
    mkdirSync(join(dir, '20260910000000_second'));
    writeFileSync(join(dir, '20260910000000_second', 'migration.sql'), '-- second');
    mkdirSync(join(dir, '20260909000000_first'));
    writeFileSync(join(dir, '20260909000000_first', 'migration.sql'), '-- first');
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lista os diretórios de migration em ordem cronológica, ignorando migration_lock.toml', () => {
    expect(listMigrationNames(dir)).toEqual(['20260909000000_first', '20260910000000_second']);
  });

  it('devolve lista vazia para um diretório vazio (não lança)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'migrations-empty-'));
    try {
      expect(listMigrationNames(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('readMigrationSql', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migrations-test-'));
    mkdirSync(join(dir, '20260909000000_first'));
    writeFileSync(join(dir, '20260909000000_first', 'migration.sql'), 'CREATE TABLE "X" (id TEXT);');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lê o conteúdo do migration.sql de um diretório de migration', () => {
    expect(readMigrationSql(dir, '20260909000000_first')).toBe('CREATE TABLE "X" (id TEXT);');
  });
});
