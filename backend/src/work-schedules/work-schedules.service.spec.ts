import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { WorkSchedulesService } from './work-schedules.service';

describe('WorkSchedulesService', () => {
  let service: WorkSchedulesService;
  let prisma: { employee: Record<string, jest.Mock>; workSchedule: Record<string, jest.Mock> };

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
      workSchedule: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), delete: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        WorkSchedulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(WorkSchedulesService);
  });

  it('creates a valid work schedule scoped to the current company', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.workSchedule.create.mockResolvedValue({ id: 'schedule-1' });

    await service.create(validDto);

    expect(prisma.employee.findFirst).toHaveBeenCalledWith({ where: { id: 'employee-1', companyId: 'company-1' } });
    expect(prisma.workSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1', weekDays: [1, 2, 3, 4, 5] }),
    });
  });

  it('rejects an employeeId belonging to a different company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.create(validDto)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.workSchedule.create).not.toHaveBeenCalled();
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
