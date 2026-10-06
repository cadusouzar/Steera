import { BadRequestException } from '@nestjs/common';
import { parseReportPeriod } from './report-period.util';

describe('parseReportPeriod', () => {
  it('sem from e sem to devolve undefined (relatório sem período)', () => {
    expect(parseReportPeriod(undefined, undefined)).toBeUndefined();
  });

  it('com os dois devolve as datas', () => {
    const p = parseReportPeriod('2026-10-05T11:00:00.000Z', '2026-10-06T04:00:59.999Z');
    expect(p?.from.toISOString()).toBe('2026-10-05T11:00:00.000Z');
    expect(p?.to.toISOString()).toBe('2026-10-06T04:00:59.999Z');
  });

  it('só um dos dois é 400', () => {
    expect(() => parseReportPeriod('2026-10-05T11:00:00.000Z', undefined)).toThrow(
      new BadRequestException('Informe o início e o fim do período.'),
    );
    expect(() => parseReportPeriod(undefined, '2026-10-05T11:00:00.000Z')).toThrow(BadRequestException);
  });

  it('início igual ou depois do fim é 400', () => {
    expect(() => parseReportPeriod('2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z')).toThrow(
      new BadRequestException('O início do período precisa ser antes do fim.'),
    );
  });

  it('mais de 366 dias é 400; exatamente 366 dias passa', () => {
    expect(() => parseReportPeriod('2025-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z')).toThrow(
      new BadRequestException('O período pode ter no máximo 366 dias.'),
    );
    expect(parseReportPeriod('2025-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBeDefined();
  });
});
