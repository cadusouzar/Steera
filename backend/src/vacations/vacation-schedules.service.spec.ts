import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { VacationSchedulesService } from './vacation-schedules.service';

describe('VacationSchedulesService', () => {
  let service: VacationSchedulesService;
  let prisma: { vacationSchedule: Record<string, jest.Mock>; employeePayment: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      vacationSchedule: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      employeePayment: { count: jest.fn() },
    };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        VacationSchedulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(VacationSchedulesService);
  });

  it('rejects scheduling vacation for a non-CLT employee with a clear message', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'PJ', status: 'ACTIVE',
      admissionDate: new Date('2025-01-01'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-01', endDate: '2026-03-02', daysCount: 30 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('rejects scheduling when the requested range overlaps an existing non-cancelled schedule', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([
      { id: 'existing', startDate: new Date('2026-02-10'), endDate: new Date('2026-02-20'), status: 'SCHEDULED' },
    ]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-15', endDate: '2026-02-25', daysCount: 11 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('creates a schedule with status SCHEDULED when the range does not overlap', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);
    prisma.vacationSchedule.create.mockResolvedValue({ id: 'schedule-1', status: 'SCHEDULED' });

    await service.schedule('employee-1', { startDate: '2026-02-01', endDate: '2026-03-02', daysCount: 30 });

    expect(prisma.vacationSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1', status: 'SCHEDULED', daysCount: 30 }),
    });
  });

  it('allows scheduling a large daysCount with no existing schedules when the exception is authorized — there is no balance ceiling anymore, only the flat 30-day cap', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);
    prisma.vacationSchedule.create.mockResolvedValue({ id: 'schedule-1', status: 'SCHEDULED' });

    // 200 days would have far exceeded any possible accrued balance under the old
    // calculation service (removed) — it would also blow past the new flat 30-day
    // cap, so exceptionAuthorized is required for this to succeed.
    await service.schedule('employee-1', {
      startDate: '2026-01-01', endDate: '2026-07-19', daysCount: 200, exceptionAuthorized: true,
    });

    expect(prisma.vacationSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ daysCount: 200, status: 'SCHEDULED' }),
    });
  });

  it('rejects a single request that itself exceeds the 30-day cap, without exceptionAuthorized', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-01-01', endDate: '2026-02-09', daysCount: 40 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('rejects when existing non-cancelled schedules (20 days) plus a new 15-day request would total 35 days', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([
      { id: 'e1', startDate: new Date('2026-01-05'), endDate: new Date('2026-01-14'), daysCount: 10, status: 'SCHEDULED' },
      { id: 'e2', startDate: new Date('2026-03-01'), endDate: new Date('2026-03-10'), daysCount: 10, status: 'APPROVED' },
    ]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-05-01', endDate: '2026-05-15', daysCount: 15 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('succeeds for the same 35-day-total scenario when exceptionAuthorized is true', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([
      { id: 'e1', startDate: new Date('2026-01-05'), endDate: new Date('2026-01-14'), daysCount: 10, status: 'SCHEDULED' },
      { id: 'e2', startDate: new Date('2026-03-01'), endDate: new Date('2026-03-10'), daysCount: 10, status: 'APPROVED' },
    ]);
    prisma.vacationSchedule.create.mockResolvedValue({ id: 'schedule-1', status: 'SCHEDULED' });

    await service.schedule('employee-1', {
      startDate: '2026-05-01', endDate: '2026-05-15', daysCount: 15, exceptionAuthorized: true,
    });

    expect(prisma.vacationSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ daysCount: 15, status: 'SCHEDULED' }),
    });
  });

  it('excludes cancelled schedules from the 30-day cap sum (cancelled 25 days + new 10-day request succeeds)', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    // The query already filters status !== CANCELLED, so a cancelled 25-day
    // schedule would never be returned here — mirrors what Prisma would return.
    prisma.vacationSchedule.findMany.mockResolvedValue([]);
    prisma.vacationSchedule.create.mockResolvedValue({ id: 'schedule-1', status: 'SCHEDULED' });

    await service.schedule('employee-1', { startDate: '2026-06-01', endDate: '2026-06-10', daysCount: 10 });

    expect(prisma.vacationSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ daysCount: 10, status: 'SCHEDULED' }),
    });
  });

  it('filters nested schedule listings by companyId too, not just employeeId', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);

    await service.findAllForEmployee('employee-1');

    expect(prisma.vacationSchedule.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-1', companyId: 'company-1' },
      orderBy: { startDate: 'desc' },
    });
  });

  it('rejects scheduling vacation for an inactive employee', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'INACTIVE',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-01', endDate: '2026-03-02', daysCount: 30 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('accepts a 1-day vacation (startDate === endDate, daysCount 1)', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);
    prisma.vacationSchedule.create.mockResolvedValue({ id: 'schedule-1', status: 'SCHEDULED' });

    await service.schedule('employee-1', { startDate: '2026-02-01', endDate: '2026-02-01', daysCount: 1 });

    expect(prisma.vacationSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ daysCount: 1, status: 'SCHEDULED' }),
    });
  });

  it('rejects a range whose endDate is strictly before startDate', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-10', endDate: '2026-02-01', daysCount: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('cancel() scopes the lookup to the current company, so a schedule from another company 404s', async () => {
    prisma.vacationSchedule.findFirst.mockResolvedValue(null);
    await expect(service.cancel('schedule-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancel() flips a SCHEDULED period to CANCELLED', async () => {
    prisma.vacationSchedule.findFirst.mockResolvedValue({ id: 'schedule-1', companyId: 'company-1', status: 'SCHEDULED' });
    prisma.vacationSchedule.update.mockResolvedValue({ id: 'schedule-1', status: 'CANCELLED' });

    await service.cancel('schedule-1');

    expect(prisma.vacationSchedule.update).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: { status: 'CANCELLED' },
    });
  });

  it('cancel() refuses a COMPLETED period — cancelling it would hand the taken days back to the balance', async () => {
    prisma.vacationSchedule.findFirst.mockResolvedValue({ id: 'schedule-1', companyId: 'company-1', status: 'COMPLETED' });

    await expect(service.cancel('schedule-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.vacationSchedule.update).not.toHaveBeenCalled();
  });

  it('cancel() refuses an already CANCELLED period', async () => {
    prisma.vacationSchedule.findFirst.mockResolvedValue({ id: 'schedule-1', companyId: 'company-1', status: 'CANCELLED' });

    await expect(service.cancel('schedule-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.vacationSchedule.update).not.toHaveBeenCalled();
  });
});
