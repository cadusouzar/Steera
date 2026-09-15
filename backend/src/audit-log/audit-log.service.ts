import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  // Nunca lança - um registro de auditoria que falha nunca deve derrubar a ação de negócio que o
  // disparou (ex.: uma marcação rejeitada por duplicidade precisa continuar retornando o 400 pro
  // cliente mesmo se, por algum motivo, o próprio log falhar ao gravar).
  async record(entry: {
    companyId: string;
    action: AuditAction;
    employeeId?: string;
    performedByUserId?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId: entry.companyId,
          action: entry.action,
          employeeId: entry.employeeId,
          performedByUserId: entry.performedByUserId,
          metadata: entry.metadata,
        },
      });
    } catch {
      // Silencioso de propósito - ver comentário acima do método.
    }
  }
}
