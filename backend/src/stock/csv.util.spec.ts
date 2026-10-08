import { Prisma } from '@prisma/client';
import { buildCsv, csvNumber } from './csv.util';

describe('csv.util', () => {
  it('usa ; como separador, vírgula decimal e BOM', () => {
    const text = buildCsv(['A', 'B'], [['x', new Prisma.Decimal('1.5')]]).toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('A;B\r\nx;1,5\r\n');
  });

  it('escapa aspas, ; e quebra de linha', () => {
    const text = buildCsv(['A'], [['diz "oi"; tchau\nfim']]).toString('utf8');
    expect(text).toContain('"diz ""oi""; tchau\nfim"');
  });

  it('neutraliza texto que começa como fórmula, mas não números negativos', () => {
    const text = buildCsv(['A', 'B'], [['=HYPERLINK("x")', -2]]).toString('utf8');
    expect(text).toContain(`"'=HYPERLINK(""x"")";-2`);
  });

  it('formata casas decimais fixas', () => {
    expect(csvNumber(new Prisma.Decimal('2'), 2)).toBe('2,00');
    expect(csvNumber(null)).toBe('');
  });
});
