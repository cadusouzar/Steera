import { UnprocessableEntityException } from '@nestjs/common';
import { VacationCalculationService, VACATION_RULE_VERSION } from './vacation-calculation.service';

describe('VacationCalculationService', () => {
  const service = new VacationCalculationService();

  it('reports acquisition incomplete before 12 months worked', () => {
    const result = service.calculate({
      contractType: 'CLT' as never,
      admissionDate: new Date('2026-01-15T00:00:00Z'),
      baseValue: 3000,
      daysAlreadyTaken: 0,
      referenceDate: new Date('2026-06-15T00:00:00Z'), // 5 meses depois
    });

    expect(result.acquisitionComplete).toBe(false);
    expect(result.totalAcquiredDays).toBe(0);
    expect(result.proportionalDays).toBe(10); // 5/12 * 30 arredondado pra baixo
  });

  it('grants 30 full days after exactly one completed 12-month period, plus the constitutional one-third', () => {
    const result = service.calculate({
      contractType: 'CLT' as never,
      admissionDate: new Date('2025-01-15T00:00:00Z'),
      baseValue: 3000,
      daysAlreadyTaken: 0,
      referenceDate: new Date('2026-01-15T00:00:00Z'), // exatamente 12 meses depois
    });

    expect(result.acquisitionComplete).toBe(true);
    expect(result.totalAcquiredDays).toBe(30);
    expect(result.balanceDays).toBe(30);
    // 1/3 sobre o valor proporcional de 30 dias: (3000/30 * 30) / 3 = 1000
    expect(result.oneThirdBonus).toBe(1000);
  });

  it('subtracts days already taken from the balance, never going negative', () => {
    const result = service.calculate({
      contractType: 'CLT' as never,
      admissionDate: new Date('2024-01-15T00:00:00Z'),
      baseValue: 3000,
      daysAlreadyTaken: 40, // mais que os 30 de um período — não deve ficar negativo
      referenceDate: new Date('2025-01-15T00:00:00Z'),
    });

    expect(result.balanceDays).toBe(0);
  });

  it('throws UnprocessableEntityException for non-CLT contract types', () => {
    expect(() =>
      service.calculate({
        contractType: 'PJ' as never,
        admissionDate: new Date('2025-01-15T00:00:00Z'),
        baseValue: 3000,
        daysAlreadyTaken: 0,
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('records a stable rule version string for auditability', () => {
    expect(VACATION_RULE_VERSION).toMatch(/CF\/88 art\. 7º XVII/);
  });
});
