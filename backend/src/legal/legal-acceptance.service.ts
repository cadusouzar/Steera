import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LEGAL_DOCUMENTS, LEGAL_VERSIONS } from './legal-versions';

export interface LegalAcceptanceMeta {
  ip?: string | null;
  userAgent?: string | null;
}

// Coluna LegalAcceptance.userAgent é VarChar(300) — cabeçalho maior seria erro de banco.
const USER_AGENT_MAX_LENGTH = 300;

// Só os campos usados aqui: aceita tanto o PrismaService quanto o `tx` de uma transação.
type LegalAcceptanceClient = Pick<Prisma.TransactionClient, 'legalAcceptance'>;

// Aceite dos Termos de uso e da Política de Privacidade (LGPD — Etapa A, 07/10/2026).
// LegalAcceptance é tabela CENTRAL (como User), sem RLS e fora de TENANT_TABLE_NAMES — a extensão
// de roteamento sempre a executa no client central, então nenhuma chamada daqui precisa de
// runAsSystem (que, de todo modo, só pode ser importado de src/auth/** — ver .eslintrc.js).
// Histórico: só INSERT, nunca UPDATE/DELETE.
@Injectable()
export class LegalAcceptanceService {
  constructor(private readonly prisma: PrismaService) {}

  // Documentos já aceitos NA VERSÃO VIGENTE por este login.
  private async acceptedCurrent(client: LegalAcceptanceClient, userId: string): Promise<Set<string>> {
    const rows = await client.legalAcceptance.findMany({
      where: {
        userId,
        OR: LEGAL_DOCUMENTS.map((document) => ({ document, version: LEGAL_VERSIONS[document].version })),
      },
      select: { document: true },
    });
    return new Set(rows.map((row) => row.document));
  }

  // Grava TERMS e PRIVACY na versão vigente que ainda não estiverem aceitas (idempotente). `client`:
  // o `tx` da transação de quem chama (register() grava junto com a criação do User).
  async record(userId: string, meta: LegalAcceptanceMeta, client?: LegalAcceptanceClient): Promise<void> {
    const db = client ?? this.prisma;
    const accepted = await this.acceptedCurrent(db, userId);
    const missing = LEGAL_DOCUMENTS.filter((document) => !accepted.has(document));
    if (missing.length === 0) return;
    const ip = meta.ip ?? null;
    const userAgent = meta.userAgent ? meta.userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null;
    await db.legalAcceptance.createMany({
      data: missing.map((document) => ({
        userId,
        document,
        version: LEGAL_VERSIONS[document].version,
        ip,
        userAgent,
      })),
    });
  }

  // true se faltar a versão vigente de algum documento.
  async isPending(userId: string): Promise<boolean> {
    const accepted = await this.acceptedCurrent(this.prisma, userId);
    return LEGAL_DOCUMENTS.some((document) => !accepted.has(document));
  }
}
