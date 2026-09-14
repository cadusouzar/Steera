import { BadRequestException, Injectable } from '@nestjs/common';
import { FileAssetPurpose } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { TimeTrackingSettingsService } from '../time-tracking-settings/time-tracking-settings.service';
import { WorkLocationsService } from '../work-locations/work-locations.service';
import { CreatePunchDto } from './dto/create-punch.dto';
import { haversineDistanceMeters } from './geo-distance.util';
import { computeOpenState, getNextAllowedType, validateTransition } from './time-sequence.util';

const DUPLICATE_WINDOW_MS = 10_000; // bloqueio de curto prazo contra clique duplo/requisição repetida

// "Resolver meu próprio Employee vinculado" (assert de vínculo + status ACTIVE) NÃO é
// reimplementado aqui — vem de TimeManagementAuthService.resolveOwnEmployee (Task 4), o único
// lugar do projeto que faz essa checagem, reutilizado também pelas Tasks 7/8/9.
@Injectable()
export class TimeClockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly settings: TimeTrackingSettingsService,
    private readonly workLocations: WorkLocationsService,
    private readonly timeManagementAuth: TimeManagementAuthService,
  ) {}

  private async getTodayOpenState(employeeId: string) {
    // "Hoje" pra fins de sequência olha as últimas 24h de eventos, não a data civil — cobre
    // jornada que atravessa a meia-noite sem confundir com o dia civil seguinte.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const events = await this.prisma.timeEvent.findMany({
      where: { employeeId, serverRecordedAt: { gte: since } },
      orderBy: { serverRecordedAt: 'asc' },
    });
    return { events, state: computeOpenState(events) };
  }

  async getStatus(user: AuthenticatedUser) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    const settings = await this.settings.getOrCreateDefault(user.companyId);
    const { state } = await this.getTodayOpenState(employee.id);
    return {
      nextAllowedType: getNextAllowedType(state, settings.allowExtraPeriods),
      requirePhoto: settings.requirePhoto,
      requireLocation: settings.requireLocation,
    };
  }

  async createPunch(
    user: AuthenticatedUser,
    dto: CreatePunchDto,
    photo: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
  ) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    const settings = await this.settings.getOrCreateDefault(user.companyId);

    // Bloqueio de curto prazo contra duplo clique / requisição repetida (inclusive de dois
    // dispositivos quase simultâneos) — server-side, incondicional, independente do `type`
    // solicitado (uma segunda batida de tipo DIFERENTE dentro da janela também é bloqueada).
    const recent = await this.prisma.timeEvent.findFirst({
      where: { employeeId: employee.id, serverRecordedAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
      orderBy: { serverRecordedAt: 'desc' },
    });
    if (recent) throw new BadRequestException('Aguarde alguns segundos antes de registrar outra marcação');

    const { state } = await this.getTodayOpenState(employee.id);
    const outcome = validateTransition(state, dto.type, settings.allowExtraPeriods);
    if (outcome === 'INVALID') {
      throw new BadRequestException(`Não é possível registrar "${dto.type}" no estado atual da jornada`);
    }

    if (settings.requirePhoto && !photo) {
      throw new BadRequestException('Foto obrigatória para registrar o ponto');
    }
    if (settings.requireLocation && dto.latitude == null) {
      if (!settings.allowLocationException) {
        throw new BadRequestException('Localização obrigatória para registrar o ponto');
      }
    }

    let locationStatus: 'WITHIN_RANGE' | 'OUT_OF_RANGE' | 'IMPRECISE' | 'UNAVAILABLE' | 'NOT_REQUIRED' = 'NOT_REQUIRED';
    let workLocationId: string | null = null;
    if (dto.latitude != null && dto.longitude != null) {
      const activeLocations = await this.workLocations.findAllActive();
      if (activeLocations.length > 0) {
        const match = activeLocations.find(
          (loc) =>
            haversineDistanceMeters(dto.latitude!, dto.longitude!, Number(loc.latitude), Number(loc.longitude)) <=
            loc.radiusMeters,
        );
        locationStatus = match ? 'WITHIN_RANGE' : 'OUT_OF_RANGE';
        workLocationId = match?.id ?? null;
      }
    } else if (settings.requireLocation) {
      locationStatus = 'UNAVAILABLE';
    }

    let photoAssetId: string | null = null;
    if (photo) {
      const asset = await this.files.upload(
        user.companyId,
        user.userId,
        photo,
        FileAssetPurpose.TIME_PUNCH_PHOTO,
        settings.maxAttachmentSizeBytes,
      );
      photoAssetId = asset.id;
    }

    // Nunca aceita silenciosamente com um valor nulo/fora do esperado quando algo é exigido: ou
    // vira PENDING_REVIEW (exceção autorizada pela empresa), ou já teria sido rejeitado (400)
    // acima. `outcome === 'PENDING_REVIEW'` cobre uma futura extensão da própria máquina de
    // sequência (ver comentário em time-sequence.util.ts); hoje quem decide PENDING_REVIEW é
    // sempre foto/localização.
    const validationStatus =
      outcome === 'PENDING_REVIEW' ||
      locationStatus === 'OUT_OF_RANGE' ||
      (locationStatus === 'UNAVAILABLE' && settings.allowLocationException)
        ? 'PENDING_REVIEW'
        : 'VALID';

    const event = await this.prisma.timeEvent.create({
      data: {
        companyId: user.companyId,
        employeeId: employee.id,
        type: dto.type,
        source: dto.isMobile ? 'MOBILE' : 'WEB',
        deviceReportedAt: dto.deviceReportedAt ? new Date(dto.deviceReportedAt) : undefined,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyMeters: dto.accuracyMeters,
        locationStatus,
        workLocationId,
        photoAssetId,
        validationStatus,
      },
    });

    const { state: newState } = await this.getTodayOpenState(employee.id);
    return { event, nextAllowedType: getNextAllowedType(newState, settings.allowExtraPeriods) };
  }

  async listOwnPunches(user: AuthenticatedUser, from?: string, to?: string) {
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    return this.prisma.timeEvent.findMany({
      where: {
        employeeId: employee.id,
        ...(from || to
          ? { serverRecordedAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }
          : {}),
      },
      orderBy: { serverRecordedAt: 'desc' },
    });
  }
}
