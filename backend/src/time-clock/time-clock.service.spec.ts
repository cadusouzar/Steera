import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FileAssetPurpose } from '@prisma/client';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { TimeTrackingSettingsService } from '../time-tracking-settings/time-tracking-settings.service';
import { WorkLocationsService } from '../work-locations/work-locations.service';
import { TimeClockService } from './time-clock.service';

// `tx` (o argumento passado pra função de callback) é sempre o mesmo objeto mock `prisma` deste
// arquivo — cada teste que já configura prisma.timeEvent.findFirst/findMany/create continua
// funcionando sem mudança nenhuma, já que a trava/transação são só um wrapper em volta das
// mesmas chamadas.
jest.mock('../prisma/tenant-rls.extension', () => ({
  runTenantInteractiveTransaction: jest.fn(),
}));

const user: AuthenticatedUser = {
  userId: 'user-1',
  companyId: 'company-1',
  role: 'EMPLOYEE',
  modules: ['RH'],
  mustChangePassword: false,
  hasFullPontoAccess: true,
};

const employee = { id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' };

const baseSettings = {
  id: 'settings-1',
  companyId: 'company-1',
  requirePhoto: true,
  requireLocation: true,
  allowLocationException: false,
  allowExtraPeriods: true,
  maxAttachmentSizeBytes: 5 * 1024 * 1024,
};

const photo = { buffer: Buffer.from('fake'), originalname: 'foto.jpg', mimetype: 'image/jpeg', size: 4 };

describe('TimeClockService', () => {
  let service: TimeClockService;
  let prisma: { timeEvent: Record<string, jest.Mock>; $executeRaw: jest.Mock };
  let filesService: { upload: jest.Mock };
  let settingsService: { getEffectiveSettingsForEmployee: jest.Mock };
  let workLocationsService: { findAllActive: jest.Mock };
  let timeManagementAuth: { resolveOwnEmployee: jest.Mock };
  let auditLog: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      timeEvent: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    };
    const { runTenantInteractiveTransaction } = jest.requireMock('../prisma/tenant-rls.extension');
    (runTenantInteractiveTransaction as jest.Mock).mockImplementation((_p: unknown, fn: (tx: unknown) => unknown) => fn(prisma));
    filesService = { upload: jest.fn().mockResolvedValue({ id: 'asset-1' }) };
    settingsService = { getEffectiveSettingsForEmployee: jest.fn().mockResolvedValue(baseSettings) };
    workLocationsService = { findAllActive: jest.fn().mockResolvedValue([]) };
    timeManagementAuth = { resolveOwnEmployee: jest.fn().mockResolvedValue(employee) };
    auditLog = { record: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        TimeClockService,
        { provide: PrismaService, useValue: prisma },
        { provide: FilesService, useValue: filesService },
        { provide: TimeTrackingSettingsService, useValue: settingsService },
        { provide: WorkLocationsService, useValue: workLocationsService },
        { provide: TimeManagementAuthService, useValue: timeManagementAuth },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();
    service = module.get(TimeClockService);

    // Defaults: sem batida recente (sem bloqueio de duplicidade), sem eventos hoje.
    prisma.timeEvent.findFirst.mockResolvedValue(null);
    prisma.timeEvent.findMany.mockResolvedValue([]);
    prisma.timeEvent.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'event-1', ...data }),
    );
  });

  const eventsOf = (types: string[]) => types.map((type, i) => ({ type, serverRecordedAt: new Date(2026, 0, 1, 8 + i) }));

  describe('createPunch', () => {
    it('lets an employee register their own punch (CLOCK_IN, with required photo and location within range)', async () => {
      workLocationsService.findAllActive.mockResolvedValue([
        { id: 'location-1', latitude: -23.55052, longitude: -46.633308, radiusMeters: 100, active: true },
      ]);
      prisma.timeEvent.findMany.mockResolvedValueOnce([]);
      prisma.timeEvent.findMany.mockResolvedValue(eventsOf(['CLOCK_IN']));

      const result = await service.createPunch(
        user,
        { type: 'CLOCK_IN', latitude: -23.55052, longitude: -46.633308 },
        photo,
      );

      expect(timeManagementAuth.resolveOwnEmployee).toHaveBeenCalledWith(user);
      expect(prisma.timeEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          employeeId: 'employee-1',
          type: 'CLOCK_IN',
          locationStatus: 'WITHIN_RANGE',
          workLocationId: 'location-1',
          validationStatus: 'VALID',
          photoAssetId: 'asset-1',
        }),
      });
      expect(result.nextAllowedType).toBe('CLOCK_OUT');
    });

    it('never resolves employeeId/companyId from the request body — only from resolveOwnEmployee', async () => {
      const dtoWithForeignId = {
        type: 'CLOCK_IN',
        latitude: -23.55052,
        longitude: -46.633308,
      } as unknown as Parameters<typeof service.createPunch>[1];

      await service.createPunch(user, dtoWithForeignId, photo);

      expect(prisma.timeEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ employeeId: 'employee-1', companyId: 'company-1' }),
      });
    });

    it('rejects a punch from a login with no linked employee (propagates resolveOwnEmployee ForbiddenException, clear message)', async () => {
      timeManagementAuth.resolveOwnEmployee.mockRejectedValue(
        new ForbiddenException('Seu login ainda não está vinculado a um cadastro de funcionário — vincule antes de continuar'),
      );

      await expect(service.createPunch(user, { type: 'CLOCK_IN' }, photo)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.timeEvent.create).not.toHaveBeenCalled();
    });

    it('rejects a punch from an inactive employee (propagates resolveOwnEmployee ForbiddenException)', async () => {
      timeManagementAuth.resolveOwnEmployee.mockRejectedValue(
        new ForbiddenException('Funcionário inativo não pode realizar esta ação'),
      );

      await expect(service.createPunch(user, { type: 'CLOCK_IN' }, photo)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.timeEvent.create).not.toHaveBeenCalled();
    });

    it('prevents a duplicate punch within the block window, regardless of the requested type', async () => {
      prisma.timeEvent.findFirst.mockResolvedValue({ id: 'event-0', serverRecordedAt: new Date() });

      await expect(service.createPunch(user, { type: 'BREAK_START' }, photo)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.timeEvent.create).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith({
        companyId: 'company-1',
        action: 'PUNCH_DUPLICATE_REJECTED',
        employeeId: 'employee-1',
        performedByUserId: 'user-1',
        metadata: { requestedType: 'BREAK_START' },
      });
    });

    // Achado ao vivo (18/09/2026): um TimeEvent com serverRecordedAt no FUTURO (criado por uma
    // correção proativa com requestedTime no futuro — bug corrigido em
    // TimeAdjustmentsService.assertRequestShapeMatchesType) satisfazia `gte: now - 10s` pra
    // sempre, travando QUALQUER marcação nova do funcionário indefinidamente. Defesa em
    // profundidade: a query de duplicidade agora também limita por cima (`lte: now`), então esta
    // asserção confirma que o bound superior está de fato na query, não só confiando no bound de
    // baixo.
    it('bounds the duplicate-check query on both sides (gte AND lte "now") — a future-dated event must never count as "recent"', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requirePhoto: false, requireLocation: false });
      await service.createPunch(user, { type: 'CLOCK_IN' }, undefined);

      const [[firstCallArgs]] = prisma.timeEvent.findFirst.mock.calls;
      expect(firstCallArgs.where.serverRecordedAt.gte).toBeInstanceOf(Date);
      expect(firstCallArgs.where.serverRecordedAt.lte).toBeInstanceOf(Date);
      expect(firstCallArgs.where.serverRecordedAt.lte.getTime()).toBeGreaterThanOrEqual(
        firstCallArgs.where.serverRecordedAt.gte.getTime(),
      );
    });

    // Regressão do achado da revisão final de 14/09/2026: a checagem original era
    // findFirst-então-create sem nenhuma trava — duas requisições quase simultâneas do mesmo
    // funcionário podiam passar as duas pela checagem antes de qualquer uma criar seu evento.
    // Simula exatamente essa corrida: a pré-checagem (fora da trava) não vê nada, mas por quando o
    // código entra na transação travada, outra requisição concorrente já criou um evento —
    // a checagem AUTORITATIVA (dentro do lock) precisa pegar isso e nunca criar o segundo evento.
    it('rejects even when the unlocked pre-check passed but a concurrent request already created an event by the time the advisory lock is acquired (the actual race the lock exists to close)', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requireLocation: false });
      prisma.timeEvent.findFirst
        .mockResolvedValueOnce(null) // pré-checagem, sem trava: nada visto ainda
        .mockResolvedValueOnce({ id: 'event-from-concurrent-request', serverRecordedAt: new Date() }); // checagem autoritativa, já dentro do lock

      await expect(service.createPunch(user, { type: 'CLOCK_IN' }, photo)).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.timeEvent.create).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).toHaveBeenCalled(); // o lock foi de fato adquirido antes da checagem final
      expect(auditLog.record).toHaveBeenCalledWith({
        companyId: 'company-1',
        action: 'PUNCH_DUPLICATE_REJECTED',
        employeeId: 'employee-1',
        performedByUserId: 'user-1',
        metadata: { requestedType: 'CLOCK_IN' },
      });
    });

    it('accepts a full valid sequence with an interval: CLOCK_IN -> BREAK_START -> BREAK_END -> CLOCK_OUT', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requirePhoto: false, requireLocation: false });

      prisma.timeEvent.findMany.mockResolvedValueOnce([]);
      await service.createPunch(user, { type: 'CLOCK_IN' }, undefined);

      prisma.timeEvent.findMany.mockResolvedValue(eventsOf(['CLOCK_IN']));
      await service.createPunch(user, { type: 'BREAK_START' }, undefined);

      prisma.timeEvent.findMany.mockResolvedValue(eventsOf(['CLOCK_IN', 'BREAK_START']));
      await service.createPunch(user, { type: 'BREAK_END' }, undefined);

      prisma.timeEvent.findMany.mockResolvedValue(eventsOf(['CLOCK_IN', 'BREAK_START', 'BREAK_END']));
      const final = await service.createPunch(user, { type: 'CLOCK_OUT' }, undefined);

      expect(prisma.timeEvent.create).toHaveBeenCalledTimes(4);
      expect(final.event).toBeDefined();
    });

    it('rejects an invalid sequence (two CLOCK_IN in a row without CLOCK_OUT)', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requirePhoto: false, requireLocation: false });
      prisma.timeEvent.findMany.mockResolvedValue(eventsOf(['CLOCK_IN']));

      await expect(service.createPunch(user, { type: 'CLOCK_IN' }, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.timeEvent.create).not.toHaveBeenCalled();
    });

    it('allows EXTRA_IN when allowExtraPeriods is true and the journey is open with nothing else in progress', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({
        ...baseSettings,
        requirePhoto: false,
        requireLocation: false,
        allowExtraPeriods: true,
      });
      prisma.timeEvent.findMany.mockResolvedValueOnce(eventsOf(['CLOCK_IN']));
      prisma.timeEvent.findMany.mockResolvedValue(eventsOf(['CLOCK_IN', 'EXTRA_IN']));

      const result = await service.createPunch(user, { type: 'EXTRA_IN' }, undefined);

      expect(prisma.timeEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'EXTRA_IN' }) });
      expect(result.nextAllowedType).toBe('EXTRA_OUT');
    });

    it('rejects EXTRA_IN when allowExtraPeriods is false, even with an open journey', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({
        ...baseSettings,
        requirePhoto: false,
        requireLocation: false,
        allowExtraPeriods: false,
      });
      prisma.timeEvent.findMany.mockResolvedValue(eventsOf(['CLOCK_IN']));

      await expect(service.createPunch(user, { type: 'EXTRA_IN' }, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.timeEvent.create).not.toHaveBeenCalled();
    });

    it('records location within the configured WorkLocation radius as WITHIN_RANGE / VALID', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requirePhoto: false });
      workLocationsService.findAllActive.mockResolvedValue([
        { id: 'location-1', latitude: -23.55052, longitude: -46.633308, radiusMeters: 200, active: true },
      ]);

      await service.createPunch(user, { type: 'CLOCK_IN', latitude: -23.5505, longitude: -46.6333 }, undefined);

      expect(prisma.timeEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ locationStatus: 'WITHIN_RANGE', workLocationId: 'location-1', validationStatus: 'VALID' }),
      });
    });

    it('records a location outside every configured WorkLocation radius as OUT_OF_RANGE / PENDING_REVIEW — never rejected outright, never silently VALID', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requirePhoto: false });
      workLocationsService.findAllActive.mockResolvedValue([
        { id: 'location-1', latitude: -23.55052, longitude: -46.633308, radiusMeters: 100, active: true },
      ]);

      // ~360km away (Rio de Janeiro) — far outside any 100m radius.
      const result = await service.createPunch(
        user,
        { type: 'CLOCK_IN', latitude: -22.906847, longitude: -43.172897 },
        undefined,
      );

      expect(prisma.timeEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ locationStatus: 'OUT_OF_RANGE', workLocationId: null, validationStatus: 'PENDING_REVIEW' }),
      });
      expect(result.event).toBeDefined();
    });

    it('rejects when location is required, missing, and no exception is authorized', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({
        ...baseSettings,
        requirePhoto: false,
        requireLocation: true,
        allowLocationException: false,
      });

      await expect(service.createPunch(user, { type: 'CLOCK_IN' }, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.timeEvent.create).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith({
        companyId: 'company-1',
        action: 'PUNCH_VALIDATION_REJECTED',
        employeeId: 'employee-1',
        performedByUserId: 'user-1',
        metadata: { requestedType: 'CLOCK_IN', reason: 'missing_required_location' },
      });
    });

    it('accepts (as PENDING_REVIEW, never plain VALID) when location is required, missing, but the exception is authorized', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({
        ...baseSettings,
        requirePhoto: false,
        requireLocation: true,
        allowLocationException: true,
      });

      const result = await service.createPunch(user, { type: 'CLOCK_IN' }, undefined);

      expect(prisma.timeEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ locationStatus: 'UNAVAILABLE', validationStatus: 'PENDING_REVIEW' }),
      });
      expect(result.event).toBeDefined();
    });

    it('rejects when photo is required and missing', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requirePhoto: true, requireLocation: false });

      await expect(service.createPunch(user, { type: 'CLOCK_IN' }, undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.timeEvent.create).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith({
        companyId: 'company-1',
        action: 'PUNCH_VALIDATION_REJECTED',
        employeeId: 'employee-1',
        performedByUserId: 'user-1',
        metadata: { requestedType: 'CLOCK_IN', reason: 'missing_required_photo' },
      });
    });

    it('uploads the photo via FilesService with the TIME_PUNCH_PHOTO purpose and the company max attachment size', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requireLocation: false, maxAttachmentSizeBytes: 1234 });
      filesService.upload.mockResolvedValue({ id: 'asset-9' });

      await service.createPunch(user, { type: 'CLOCK_IN' }, photo);

      expect(filesService.upload).toHaveBeenCalledWith('company-1', 'user-1', photo, FileAssetPurpose.TIME_PUNCH_PHOTO, 1234);
    });
  });

  describe('getStatus', () => {
    it('returns CLOCK_IN as the only allowed next action for a fresh employee with no events today', async () => {
      const status = await service.getStatus(user);
      expect(status.nextAllowedType).toBe('CLOCK_IN');
    });

    it('reflects settings.requirePhoto/requireLocation', async () => {
      settingsService.getEffectiveSettingsForEmployee.mockResolvedValue({ ...baseSettings, requirePhoto: false, requireLocation: true });
      const status = await service.getStatus(user);
      expect(status.requirePhoto).toBe(false);
      expect(status.requireLocation).toBe(true);
    });
  });

  describe('listOwnPunches', () => {
    it('scopes the query to the caller\'s own employeeId only', async () => {
      prisma.timeEvent.findMany.mockResolvedValue([]);
      await service.listOwnPunches(user);
      expect(prisma.timeEvent.findMany).toHaveBeenCalledWith({
        where: { employeeId: 'employee-1', voidedAt: null },
        orderBy: { serverRecordedAt: 'desc' },
      });
    });

    it('rejects for a login with no linked employee', async () => {
      timeManagementAuth.resolveOwnEmployee.mockRejectedValue(new ForbiddenException('sem vínculo'));
      await expect(service.listOwnPunches(user)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
