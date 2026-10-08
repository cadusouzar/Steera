import { LegalDocument } from '@prisma/client';

// Versão VIGENTE de cada documento legal (LGPD — Etapa A, 07/10/2026). Publicar uma versão nova =
// subir `version` (e a data) aqui: todo login que só aceitou a anterior passa a ver a tela de
// reaceite (LegalAcceptanceGuard / legalAcceptancePending). O frontend espelha estes valores em
// src/lib/legal.ts — os dois precisam mudar juntos.
export const LEGAL_VERSIONS = {
  TERMS: { version: 1, effectiveDate: '2026-10-07' },
  PRIVACY: { version: 1, effectiveDate: '2026-10-07' },
} as const satisfies Record<LegalDocument, { version: number; effectiveDate: string }>;

export const LEGAL_DOCUMENTS = Object.keys(LEGAL_VERSIONS) as LegalDocument[];

export const LEGAL_ACCEPTANCE_REQUIRED_MESSAGE = 'Aceite os Termos de uso e a Política de Privacidade para continuar.';
