import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FileAssetPurpose, Prisma, TimeAdjustmentRequest } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { buildFileDownloadPath } from '../files/download-token.util';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateAdjustmentRequestDto } from './dto/create-adjustment-request.dto';
import { ProactiveCorrectionDto } from './dto/proactive-correction.dto';

interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class TimeAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  // `downloadUrl` pronto SÓ quando a solicitação tem anexo — mesmo padrão de
  // TimeJustificationsService/TimeClockService (decisão de interface do Task 11).
  private withDownloadUrl<T extends TimeAdjustmentRequest>(request: T) {
    return { ...request, downloadUrl: request.attachmentAssetId ? buildFileDownloadPath(request.attachmentAssetId) : null };
  }

  // Confere que `relatedEventId`, quando informado, é de fato um TimeEvent do PRÓPRIO
  // `employeeId` (não um id de outro funcionário, mesmo da mesma empresa) — o brief não valida
  // isso, mas sem essa checagem um funcionário mal-intencionado poderia referenciar o evento de um
  // colega, e uma aprovação posterior gravaria o "valor original" ERRADO (o de outra pessoa) na
  // trilha de auditoria da correção. 404 (nunca 403) — mesmo padrão do resto do projeto.
  private async assertRelatedEventBelongsToEmployee(relatedEventId: string, employeeId: string) {
    const event = await this.prisma.timeEvent.findFirst({ where: { id: relatedEventId, employeeId } });
    if (!event) throw new NotFoundException(`Evento ${relatedEventId} não encontrado`);
  }

  // Validação mínima de coerência tipo<->campos: ADD_MISSING_PUNCH precisa dizer QUAL evento
  // adicionar (requestedEventType + requestedTime); CORRECT_TIME/REMOVE_PUNCH precisam dizer QUAL
  // evento existente é o alvo (relatedEventId). Não é uma regra trabalhista — é validação de
  // entrada, sem ela approve() criaria um TimeEvent com type:'CLOCK_IN' e horário "agora" por
  // padrão (fallback silencioso do brief original) mesmo quando isso não é o que foi pedido.
  private assertRequestShapeMatchesType(dto: { type: string; relatedEventId?: string; requestedEventType?: string; requestedTime?: string }) {
    if (dto.type === 'ADD_MISSING_PUNCH' && (!dto.requestedEventType || !dto.requestedTime)) {
      throw new BadRequestException('requestedEventType e requestedTime são obrigatórios para ADD_MISSING_PUNCH');
    }
    if ((dto.type === 'CORRECT_TIME' || dto.type === 'REMOVE_PUNCH') && !dto.relatedEventId) {
      throw new BadRequestException('relatedEventId é obrigatório para CORRECT_TIME/REMOVE_PUNCH');
    }
  }

  async create(user: AuthenticatedUser, dto: CreateAdjustmentRequestDto, attachment?: UploadedAttachment) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    this.assertRequestShapeMatchesType(dto);
    if (dto.relatedEventId) await this.assertRelatedEventBelongsToEmployee(dto.relatedEventId, employee.id);

    let attachmentAssetId: string | undefined;
    if (attachment) {
      const asset = await this.files.upload(user.companyId, user.userId, attachment, FileAssetPurpose.ADJUSTMENT_ATTACHMENT);
      attachmentAssetId = asset.id;
    }

    const created = await this.prisma.timeAdjustmentRequest.create({
      data: {
        companyId: user.companyId,
        employeeId: employee.id,
        targetDate: new Date(dto.targetDate),
        relatedEventId: dto.relatedEventId,
        type: dto.type,
        requestedEventType: dto.requestedEventType,
        requestedTime: dto.requestedTime ? new Date(dto.requestedTime) : undefined,
        reason: dto.reason,
        justification: dto.justification,
        attachmentAssetId,
      },
    });
    return this.withDownloadUrl(created);
  }

  async listOwn(user: AuthenticatedUser) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    const items = await this.prisma.timeAdjustmentRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((item) => this.withDownloadUrl(item));
  }

  async cancel(user: AuthenticatedUser, id: string) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    const request = await this.prisma.timeAdjustmentRequest.findFirst({ where: { id, employeeId: employee.id } });
    if (!request) throw new NotFoundException(`Solicitação ${id} não encontrada`);
    if (request.status !== 'PENDING') throw new ConflictException('Só é possível cancelar solicitações pendentes');
    const updated = await this.prisma.timeAdjustmentRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.withDownloadUrl(updated);
  }

  // Listagem administrativa: ADMIN vê tudo da empresa; um superior direto vê só as solicitações
  // dos seus subordinados diretos (via TimeManagementAuthService.getManageableEmployeeIds, nunca
  // reimplementado aqui). Paginado e filtrável por status, mesmo padrão de EmployeesService.findAll.
  async listForAdmin(user: AuthenticatedUser, status?: string, page = 1, pageSize = 20) {
    const manageable = await this.timeManagementAuth.getManageableEmployeeIds(user);
    if (manageable !== 'ALL' && manageable.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const where: Prisma.TimeAdjustmentRequestWhereInput = {
      ...(manageable === 'ALL' ? {} : { employeeId: { in: manageable } }),
      ...(status ? { status: status as Prisma.EnumTimeAdjustmentStatusFilter['equals'] } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.timeAdjustmentRequest.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.timeAdjustmentRequest.count({ where }),
    ]);
    return { items: items.map((item) => this.withDownloadUrl(item)), total, page, pageSize };
  }

  async approve(user: AuthenticatedUser, id: string, reviewNote: string | undefined) {
    const request = await this.prisma.timeAdjustmentRequest.findFirst({ where: { id, companyId: user.companyId } });
    if (!request) throw new NotFoundException(`Solicitação ${id} não encontrada`);
    await this.timeManagementAuth.assertCanManage(user, request.employeeId);
    if (request.status !== 'PENDING') {
      throw new ConflictException('Esta solicitação já foi processada e não pode ser aprovada novamente');
    }

    let originalValue: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
    if (request.relatedEventId) {
      const original = await this.prisma.timeEvent.findUnique({ where: { id: request.relatedEventId } });
      originalValue = original ? { type: original.type, serverRecordedAt: original.serverRecordedAt.toISOString() } : Prisma.JsonNull;
    }

    return runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const correctedEvent = await tx.timeEvent.create({
        data: {
          companyId: request.companyId,
          employeeId: request.employeeId,
          type: request.requestedEventType ?? 'CLOCK_IN',
          source: 'ADMIN_MANUAL',
          serverRecordedAt: request.requestedTime ?? new Date(),
          validationStatus: 'CORRECTED',
        },
      });
      const correction = await tx.timeCorrection.create({
        data: {
          companyId: request.companyId,
          adjustmentRequestId: request.id,
          originalEventId: request.relatedEventId,
          originalValue,
          correctedEventId: correctedEvent.id,
          correctedValue: { type: correctedEvent.type, serverRecordedAt: correctedEvent.serverRecordedAt.toISOString() },
          requestedByEmployeeId: request.employeeId,
          reviewedByUserId: user.userId,
          reason: reviewNote ?? request.reason,
        },
      });
      await tx.timeAdjustmentRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewedByUserId: user.userId, reviewNote, reviewedAt: new Date() },
      });
      return correction;
    });
  }

  async reject(user: AuthenticatedUser, id: string, reviewNote: string | undefined) {
    const request = await this.prisma.timeAdjustmentRequest.findFirst({ where: { id, companyId: user.companyId } });
    if (!request) throw new NotFoundException(`Solicitação ${id} não encontrada`);
    await this.timeManagementAuth.assertCanManage(user, request.employeeId);
    if (request.status !== 'PENDING') {
      throw new ConflictException('Esta solicitação já foi processada e não pode ser rejeitada novamente');
    }
    if (!reviewNote) throw new BadRequestException('Motivo da rejeição é obrigatório');
    const updated = await this.prisma.timeAdjustmentRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedByUserId: user.userId, reviewNote, reviewedAt: new Date() },
    });
    return this.withDownloadUrl(updated);
  }

  // Correção proativa (sem solicitação prévia do funcionário) — reaproveita approve() em vez de
  // ter um caminho de escrita "silencioso" separado: cria a solicitação já como PENDING e aprova
  // na sequência, então a MESMA trilha de auditoria (TimeCorrection, com requestedByEmployeeId
  // sendo o próprio alvo da correção e reviewedByUserId sendo quem corrigiu) é gerada sempre,
  // nunca uma escrita direta em TimeEvent por fora desse fluxo.
  async proactiveCorrect(user: AuthenticatedUser, employeeId: string, dto: ProactiveCorrectionDto) {
    await this.timeManagementAuth.assertCanManage(user, employeeId);
    this.assertRequestShapeMatchesType(dto);
    if (dto.relatedEventId) await this.assertRelatedEventBelongsToEmployee(dto.relatedEventId, employeeId);

    const request = await this.prisma.timeAdjustmentRequest.create({
      data: {
        companyId: user.companyId,
        employeeId,
        targetDate: new Date(dto.targetDate),
        relatedEventId: dto.relatedEventId,
        type: dto.type,
        requestedEventType: dto.requestedEventType,
        requestedTime: dto.requestedTime ? new Date(dto.requestedTime) : undefined,
        reason: dto.reason,
        status: 'PENDING',
      },
    });
    return this.approve(user, request.id, dto.reason);
  }
}
