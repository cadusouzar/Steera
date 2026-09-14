import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FileAssetPurpose, JustificationType, Prisma, TimeJustification } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { buildFileDownloadPath } from '../files/download-token.util';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateJustificationDto } from './dto/create-justification.dto';

interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

// Justificativa/atestado nunca vira TimeEvent nem TimeCorrection — diferente de
// TimeAdjustmentsService de propósito: aprovar uma justificativa é só um registro analisado
// (nada é corrigido automaticamente na apuração). Ver task-9-brief.md, Passo 1.
@Injectable()
export class TimeJustificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  // Anexa um `downloadUrl` pronto (path relativo com token de download de curta duração já
  // embutido, ver download-token.util.ts) SÓ quando o registro tem attachmentAssetId — nunca
  // gerado "à toa" para quem não deveria ver. A própria chamada deste método só acontece depois
  // que o chamador já foi confirmado autorizado (dono, via resolveOwnEmployee em listOwn(), ou
  // canManage, via o WHERE já escopado em listForAdmin()) — gerar o token aqui, e só aqui, é o que
  // fecha a lacuna apontada no brief ("attachmentAssetId só é resolvido pra quem tem canManage"):
  // sem isso, GET /file-assets/:id nunca teria como ser chamado por ninguém, autorizado ou não, já
  // que generateDownloadToken() não tinha nenhum call site em todo o projeto até esta task. Nome
  // do campo (`downloadUrl`, não um token cru) e formato (path relativo) seguem a decisão de
  // interface do Task 11 (frontend api.ts) — o frontend nunca monta token/URL sozinho.
  private withDownloadToken<T extends { attachmentAssetId: string | null }>(record: T) {
    return {
      ...record,
      downloadUrl: record.attachmentAssetId ? buildFileDownloadPath(record.attachmentAssetId) : null,
    };
  }

  async create(user: AuthenticatedUser, dto: CreateJustificationDto, attachment?: UploadedAttachment) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);

    if (dto.type === JustificationType.MEDICAL_CERTIFICATE && !attachment) {
      throw new BadRequestException('Atestado médico exige anexo');
    }

    let attachmentAssetId: string | undefined;
    if (attachment) {
      const asset = await this.files.upload(user.companyId, user.userId, attachment, FileAssetPurpose.JUSTIFICATION_ATTACHMENT);
      attachmentAssetId = asset.id;
    }

    // `status` nasce sempre PENDING (default do schema) — envio nunca aprova automaticamente,
    // independente de ter anexo ou não.
    const created = await this.prisma.timeJustification.create({
      data: {
        companyId: user.companyId,
        employeeId: employee.id,
        type: dto.type,
        description: dto.description,
        relatedDate: dto.relatedDate ? new Date(dto.relatedDate) : undefined,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        attachmentAssetId,
      },
    });
    return this.withDownloadToken(created);
  }

  async listOwn(user: AuthenticatedUser) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    const items = await this.prisma.timeJustification.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((item) => this.withDownloadToken(item));
  }

  // Mesmo padrão de TimeAdjustmentsService.listForAdmin: ADMIN vê a empresa inteira, um superior
  // direto vê só seus subordinados diretos — nunca filtrado record-a-record aqui, o WHERE já
  // nasce escopado por getManageableEmployeeIds().
  async listForAdmin(user: AuthenticatedUser, status?: string, page = 1, pageSize = 20) {
    const manageable = await this.timeManagementAuth.getManageableEmployeeIds(user);
    if (manageable !== 'ALL' && manageable.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const where: Prisma.TimeJustificationWhereInput = {
      ...(manageable === 'ALL' ? {} : { employeeId: { in: manageable } }),
      ...(status ? { status: status as Prisma.EnumJustificationStatusFilter['equals'] } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.timeJustification.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      this.prisma.timeJustification.count({ where }),
    ]);
    return { items: items.map((item) => this.withDownloadToken(item)), total, page, pageSize };
  }

  private async findReviewable(user: AuthenticatedUser, id: string): Promise<TimeJustification> {
    const justification = await this.prisma.timeJustification.findFirst({ where: { id, companyId: user.companyId } });
    if (!justification) throw new NotFoundException(`Justificativa ${id} não encontrada`);
    await this.timeManagementAuth.assertCanManage(user, justification.employeeId);
    if (justification.status !== 'PENDING') {
      throw new ConflictException('Esta justificativa já foi analisada e não pode ser reprocessada');
    }
    return justification;
  }

  // Só atualiza status/reviewedByUserId/reviewNote/reviewedAt — NUNCA cria/altera um TimeEvent
  // (diferente de TimeAdjustmentsService.approve() de propósito).
  async approve(user: AuthenticatedUser, id: string, reviewNote: string | undefined) {
    await this.findReviewable(user, id);
    return this.prisma.timeJustification.update({
      where: { id },
      data: { status: 'APPROVED', reviewedByUserId: user.userId, reviewNote, reviewedAt: new Date() },
    });
  }

  async reject(user: AuthenticatedUser, id: string, reviewNote: string | undefined) {
    await this.findReviewable(user, id);
    if (!reviewNote) throw new BadRequestException('Motivo da rejeição é obrigatório');
    return this.prisma.timeJustification.update({
      where: { id },
      data: { status: 'REJECTED', reviewedByUserId: user.userId, reviewNote, reviewedAt: new Date() },
    });
  }
}
