// Espelho de backend/src/legal/legal-versions.ts — manter os dois em sincronia ao publicar uma nova versão.
export const LEGAL_VERSIONS = {
  TERMS: { version: 1, effectiveDate: '2026-10-07' },
  PRIVACY: { version: 1, effectiveDate: '2026-10-07' },
} as const;

export const LEGAL_CONTACT_EMAIL = 'carlos@steera.com.br';

/** '2026-10-07' -> '07/10/2026' (sem passar por Date, para não sofrer com fuso). */
export function formatLegalDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}
