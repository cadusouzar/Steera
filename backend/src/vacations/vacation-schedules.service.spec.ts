import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { VacationCalculationService } from './vacation-calculation.service';
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
        VacationCalculationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(VacationSchedulesService);
  });

  it('rejects vacation status/simulation for a non-CLT employee with a clear message', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'PJ', admissionDate: new Date('2025-01-01'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);
    await expect(service.status('employee-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('simulate() never persists a VacationSchedule row', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2025-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);

    await service.simulate('employee-1', { startDate: '2026-02-01', endDate: '2026-03-02', daysCount: 30 });

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

  it('creates a schedule with status SCHEDULED when the range does not overlap and balance is sufficient', async () => {
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

  it('counts existing SCHEDULED (not just COMPLETED) days against the balance, preventing double-booking', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    // A prior SCHEDULED (not COMPLETED) period alone already exceeds any possible accrued
    // balance, so — regardless of today's date — the balance check must reject a second,
    // non-overlapping booking.
    prisma.vacationSchedule.findMany.mockResolvedValueOnce([{ id: 'existing', daysCount: 9999, status: 'SCHEDULED' }]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-06-01', endDate: '2026-06-28', daysCount: 28 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.vacationSchedule.create).not.toHaveBeenCalled();
  });

  it('queries daysAlreadyTaken() including SCHEDULED and APPROVED statuses, not just COMPLETED/IN_PROGRESS', async () => {
    // The two tests above stub the whole findMany() call, so they can't actually tell a
    // correct status filter apart from a stale one (the mock returns whatever we configure
    // regardless of the `where` clause the production code sends it) — only a real Postgres
    // query would filter rows differently. This test instead asserts on the exact `where`
    // argument passed to findMany(), which is the only way this mock-based suite can guard
    // against someone reverting the status list and silently reintroducing the double-booking
    // bug fixed in this round.
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT',
      admissionDate: new Date('2024-01-01T00:00:00Z'), baseValue: 3000,
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([]);

    await service.status('employee-1');

    expect(prisma.vacationSchedule.findMany).toHaveBeenCalledWith({
      where: {
        employeeId: 'employee-1',
        companyId: 'company-1',
        status: { in: ['SCHEDULED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED'] },
      },
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
