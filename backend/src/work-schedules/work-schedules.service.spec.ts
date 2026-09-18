import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { WorkSchedulesService } from './work-schedules.service';

describe('WorkSchedulesService', () => {
  let service: WorkSchedulesService;
  let prisma: {
    employee: Record<string, jest.Mock>;
    workSchedule: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };

  const admin: AuthenticatedUser = {
    userId: 'user-admin', companyId: 'company-1', role: 'ADMIN', modules: [], mustChangePassword: false, hasFullPontoAccess: true, permissions: {},
  };
  const limitedAdmin: AuthenticatedUser = {
    userId: 'u1', companyId: 'company-1', role: 'ADMIN', modules: [], mustChangePassword: false, hasFullPontoAccess: false, permissions: {},
  };
  const employeeManagerLogin: AuthenticatedUser = {
    userId: 'u2', companyId: 'company-1', role: 'EMPLOYEE', modules: [], mustChangePassword: false, hasFullPontoAccess: true, permissions: {},
  };

  const validDto: CreateWorkScheduleDto = {
    employeeId: 'employee-1',
    name: 'Comercial 8h-18h',
    weekDays: [1, 2, 3, 4, 5],
    expectedStartTime: '08:00',
    expectedEndTime: '18:00',
    breakMinutes: 60,
    dailyMinutes: 480,
    weeklyMinutes: 2400,
    validFrom: '2026-01-01',
  };

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      workSchedule: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      user: { findUnique: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkSchedulesService,
        TimeManagementAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(WorkSchedulesService);
  });

  it('creates a valid work schedule scoped to the current company', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.workSchedule.create.mockResolvedValue({ id: 'schedule-1' });

    await service.create(validDto, admin);

    expect(prisma.employee.findFirst).toHaveBeenCalledWith({ where: { id: 'employee-1', companyId: 'company-1' } });
    expect(prisma.workSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1', weekDays: [1, 2, 3, 4, 5] }),
    });
  });

  it('rejects an employeeId belonging to a different company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.create(validDto, admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.workSchedule.create).not.toHaveBeenCalled();
  });

  describe('create — three tiers', () => {
    it('creates a company-wide default row when neither employeeId nor managerId is given', async () => {
      const dto = { name: 'Padrão', weekDays: [1, 2, 3, 4, 5], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };
      prisma.workSchedule.create.mockResolvedValue({ id: 'ws-1', employeeId: null, managerId: null });

      await service.create(dto, admin);

      expect(prisma.workSchedule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ employeeId: undefined, managerId: undefined }),
      });
    });

    it('rejects both employeeId and managerId given together', async () => {
      const dto = { employeeId: 'emp-1', managerId: 'mgr-1', name: 'X', weekDays: [1], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };
      await expect(service.create(dto, admin)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.workSchedule.create).not.toHaveBeenCalled();
    });
  });

  describe('create — authorization by tier', () => {
    it('rejects a company-wide default row from a manager without hasFullPontoAccess', async () => {
      const dto = { name: 'X', weekDays: [1], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };
      await expect(service.create(dto, limitedAdmin)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows a manager to create a team-default row for their OWN team (managerId matches their own linked employee)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      const dto = { managerId: 'employee-mgr-1', name: 'Meu time', weekDays: [1], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };
      prisma.workSchedule.create.mockResolvedValue({ id: 'ws-2' });

      await service.create(dto, employeeManagerLogin);

      expect(prisma.workSchedule.create).toHaveBeenCalled();
    });

    it('rejects a manager creating a team-default row for a DIFFERENT superior, without hasFullPontoAccess', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      const dto = { managerId: 'employee-someone-else', name: 'X', weekDays: [1], expectedStartTime: '08:00', expectedEndTime: '17:00', dailyMinutes: 480, weeklyMinutes: 2400, validFrom: '2026-01-01' };

      await expect(service.create(dto, employeeManagerLogin)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('lists work schedules filtering by employeeId', async () => {
    prisma.workSchedule.findMany.mockResolvedValue([{ id: 'schedule-1', employeeId: 'employee-1' }]);
    prisma.workSchedule.count.mockResolvedValue(1);

    const result = await service.findAll({ employeeId: 'employee-1', page: 1, pageSize: 20 });

    expect(prisma.workSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1' }) }),
    );
    expect(result.items).toHaveLength(1);
  });

  it('throws NotFoundException for a schedule belonging to another company', async () => {
    prisma.workSchedule.findFirst.mockResolvedValue(null);
    await expect(service.findOne('schedule-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('remove — authorization by tier', () => {
    it('rejects a non-full-access EMPLOYEE manager deleting a company-wide schedule', async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-company-wide', companyId: 'company-1', employeeId: null, managerId: null,
      });

      await expect(service.remove('ws-company-wide', employeeManagerLogin)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workSchedule.delete).not.toHaveBeenCalled();
    });

    it('rejects an unrelated manager deleting another manager\'s team-default schedule', async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-team-other', companyId: 'company-1', employeeId: null, managerId: 'employee-someone-else',
      });
      // O login atual (employeeManagerLogin) está vinculado a 'employee-mgr-1', não ao managerId do
      // agendamento ('employee-someone-else') — não é o próprio time dele.
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });

      await expect(service.remove('ws-team-other', employeeManagerLogin)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workSchedule.delete).not.toHaveBeenCalled();
    });

    it('allows an ADMIN with hasFullPontoAccess to delete a company-wide schedule', async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-company-wide', companyId: 'company-1', employeeId: null, managerId: null,
      });
      prisma.workSchedule.delete.mockResolvedValue({ id: 'ws-company-wide' });

      await service.remove('ws-company-wide', admin);

      expect(prisma.workSchedule.delete).toHaveBeenCalledWith({ where: { id: 'ws-company-wide' } });
    });
  });

  describe('update — authorization follows the NEW employeeId on reassignment', () => {
    it('rejects reassigning an individual schedule to a NEW employee the caller cannot manage, even if they could manage the OLD one', async () => {
      // Agendamento hoje pertence a 'employee-old' (o caller consegue gerenciar esse). O DTO pede
      // pra reatribuir pra 'employee-new' — autorização tem que ser checada contra o NOVO alvo, não
      // o antigo, senão um superior poderia "roubar" o agendamento de um funcionário que não
      // gerencia só reatribuindo um que já é seu.
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-1', companyId: 'company-1', employeeId: 'employee-old', managerId: null,
      });
      // canManage() do TimeManagementAuthService consulta employee.findFirst escopado por empresa
      // pra achar o alvo — aqui simula que 'employee-new' existe na empresa, mas não é gerenciável
      // por employeeManagerLogin (managerId do alvo não bate com o employeeId do login atual),
      // enquanto 'employee-old' (o tier ATUAL, autorizado primeiro desde o fix I1) é subordinado
      // direto dele — isolando que a rejeição vem MESMO do tier novo.
      prisma.employee.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve({
          id: where.id,
          companyId: 'company-1',
          managerId: where.id === 'employee-old' ? 'employee-mgr-1' : 'employee-outro-gerente',
        }),
      );
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });

      const dto = { employeeId: 'employee-new' };

      await expect(service.update('ws-1', dto, employeeManagerLogin)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workSchedule.update).not.toHaveBeenCalled();
    });

    it('allows reassigning an individual schedule to a NEW employee the caller CAN manage', async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-1', companyId: 'company-1', employeeId: 'employee-old', managerId: null,
      });
      // 'employee-new' e 'employee-old' são os dois subordinados diretos do Employee vinculado a
      // employeeManagerLogin — o caller pode autorar tanto o tier atual quanto o novo.
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-new', companyId: 'company-1', managerId: 'employee-mgr-1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      prisma.workSchedule.update.mockResolvedValue({ id: 'ws-1', employeeId: 'employee-new' });

      const dto = { employeeId: 'employee-new' };

      await service.update('ws-1', dto, employeeManagerLogin);

      expect(prisma.workSchedule.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: expect.objectContaining({ employeeId: 'employee-new' }),
      });
    });
  });

  // Achado I1 da revisão final (15/09/2026): update() autorizava SÓ o tier novo, nunca o atual —
  // um superior que nem consegue ver o agendamento (findAll/findOne negam) podia mesmo assim
  // "roubá-lo" via PATCH, bastando saber o id e ser capaz de autorar o tier de destino.
  describe('update — authorizes BOTH the current tier and the new tier', () => {
    // Quem o login atual gerencia: só 'employee-meu'. 'employee-alheio' é subordinado de outro.
    const mockEmployeesByManager = () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', employeeId: 'employee-mgr-1' });
      prisma.employee.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'employee-meu'
            ? { id: 'employee-meu', companyId: 'company-1', managerId: 'employee-mgr-1' }
            : { id: where.id, companyId: 'company-1', managerId: 'employee-outro-gerente' },
        ),
      );
    };

    it('rejects converting the COMPANY-WIDE default into the calling manager\'s own team schedule (can author the new tier, not the old one)', async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-company-wide', companyId: 'company-1', employeeId: null, managerId: null,
      });
      mockEmployeesByManager();

      await expect(
        service.update('ws-company-wide', { managerId: 'employee-mgr-1' }, employeeManagerLogin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workSchedule.update).not.toHaveBeenCalled();
    });

    it("rejects re-homing ANOTHER manager's team schedule to the calling manager's own team", async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-team-other', companyId: 'company-1', employeeId: null, managerId: 'employee-someone-else',
      });
      mockEmployeesByManager();

      await expect(
        service.update('ws-team-other', { managerId: 'employee-mgr-1' }, employeeManagerLogin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workSchedule.update).not.toHaveBeenCalled();
    });

    it("rejects stealing an individual schedule of an employee the caller does NOT manage, by pointing it at one they DO", async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-alheio', companyId: 'company-1', employeeId: 'employee-alheio', managerId: null,
      });
      mockEmployeesByManager();

      await expect(
        service.update('ws-alheio', { employeeId: 'employee-meu' }, employeeManagerLogin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workSchedule.update).not.toHaveBeenCalled();
    });

    it('rejects the opposite direction too: a schedule the caller CAN touch, moved to a tier they cannot author', async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-meu', companyId: 'company-1', employeeId: 'employee-meu', managerId: null,
      });
      mockEmployeesByManager();

      await expect(
        service.update('ws-meu', { employeeId: 'employee-alheio' }, employeeManagerLogin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.workSchedule.update).not.toHaveBeenCalled();
    });

    it('allows a plain edit (no tier change) of a schedule the caller already owns', async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-meu-time', companyId: 'company-1', employeeId: null, managerId: 'employee-mgr-1',
      });
      mockEmployeesByManager();
      prisma.workSchedule.update.mockResolvedValue({ id: 'ws-meu-time', name: 'Novo nome' });

      await service.update('ws-meu-time', { name: 'Novo nome' }, employeeManagerLogin);

      expect(prisma.workSchedule.update).toHaveBeenCalledWith({
        where: { id: 'ws-meu-time' },
        data: expect.objectContaining({ name: 'Novo nome' }),
      });
    });

    it('a full-access ADMIN can still re-home any schedule across tiers', async () => {
      prisma.workSchedule.findFirst.mockResolvedValue({
        id: 'ws-company-wide', companyId: 'company-1', employeeId: null, managerId: null,
      });
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-mgr-1', companyId: 'company-1', managerId: null });
      prisma.workSchedule.update.mockResolvedValue({ id: 'ws-company-wide', managerId: 'employee-mgr-1' });

      await service.update('ws-company-wide', { managerId: 'employee-mgr-1' }, admin);

      expect(prisma.workSchedule.update).toHaveBeenCalled();
    });
  });

  // Validação de formato (HH:mm) e de weekDays (0-6) acontece no DTO via
  // @Matches/@Min/@Max + ValidationPipe global (main.ts) — não no service.
  // Testado aqui diretamente com class-validator, mesmo mecanismo que o
  // ValidationPipe usa por baixo, já que não há suíte e2e configurada neste
  // projeto (ver CLAUDE.md).
  describe('CreateWorkScheduleDto validation', () => {
    it('rejects a start time outside HH:mm format ("25:00")', async () => {
      const dto = plainToInstance(CreateWorkScheduleDto, { ...validDto, expectedStartTime: '25:00' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'expectedStartTime')).toBe(true);
    });

    it('rejects a start time missing the leading zero ("9:00")', async () => {
      const dto = plainToInstance(CreateWorkScheduleDto, { ...validDto, expectedStartTime: '9:00' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'expectedStartTime')).toBe(true);
    });

    it('rejects weekDays containing a value outside 0-6', async () => {
      const dto = plainToInstance(CreateWorkScheduleDto, { ...validDto, weekDays: [0, 7] });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'weekDays')).toBe(true);
    });

    it('rejects weekDays containing a negative value', async () => {
      const dto = plainToInstance(CreateWorkScheduleDto, { ...validDto, weekDays: [-1, 2] });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'weekDays')).toBe(true);
    });

    it('accepts a fully valid DTO', async () => {
      const dto = plainToInstance(CreateWorkScheduleDto, validDto);
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
