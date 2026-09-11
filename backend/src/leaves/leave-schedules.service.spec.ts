import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { LeaveSchedulesService } from './leave-schedules.service';

describe('LeaveSchedulesService', () => {
  let service: LeaveSchedulesService;
  let prisma: { leaveSchedule: Record<string, jest.Mock>; vacationSchedule: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      leaveSchedule: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      vacationSchedule: { findMany: jest.fn() },
    };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        LeaveSchedulesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(LeaveSchedulesService);

    prisma.leaveSchedule.findMany.mockResolvedValue([]);
    prisma.vacationSchedule.findMany.mockResolvedValue([]);
  });

  it('creates a schedule successfully for any contract type — PJ included, no CLT restriction', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'PJ', status: 'ACTIVE',
    });
    prisma.leaveSchedule.create.mockResolvedValue({ id: 'leave-1', status: 'SCHEDULED' });

    await service.schedule('employee-1', {
      startDate: '2026-02-01', endDate: '2026-02-05', daysCount: 5, reason: 'Licença médica',
    });

    expect(prisma.leaveSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1', employeeId: 'employee-1', daysCount: 5,
        reason: 'Licença médica', status: 'SCHEDULED',
      }),
    });
  });

  it('rejects scheduling leave for an inactive employee', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'INACTIVE',
    });

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-01', endDate: '2026-02-05', daysCount: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveSchedule.create).not.toHaveBeenCalled();
  });

  it('rejects scheduling when the requested range overlaps an existing non-cancelled LeaveSchedule', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
    });
    prisma.leaveSchedule.findMany.mockResolvedValue([
      { id: 'existing', startDate: new Date('2026-02-10'), endDate: new Date('2026-02-20'), status: 'SCHEDULED' },
    ]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-15', endDate: '2026-02-25', daysCount: 11 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveSchedule.create).not.toHaveBeenCalled();
  });

  it('rejects scheduling when the requested range overlaps an existing non-cancelled VacationSchedule (cross-table check)', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([
      { id: 'vacation-1', startDate: new Date('2026-02-10'), endDate: new Date('2026-02-20'), status: 'APPROVED' },
    ]);

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-15', endDate: '2026-02-25', daysCount: 11 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveSchedule.create).not.toHaveBeenCalled();
  });

  it('accepts a 1-day leave (startDate === endDate, daysCount 1)', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
    });
    prisma.leaveSchedule.create.mockResolvedValue({ id: 'leave-1', status: 'SCHEDULED' });

    await service.schedule('employee-1', { startDate: '2026-02-01', endDate: '2026-02-01', daysCount: 1 });

    expect(prisma.leaveSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ daysCount: 1, status: 'SCHEDULED' }),
    });
  });

  it('rejects a range whose endDate is strictly before startDate', async () => {
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
    });

    await expect(
      service.schedule('employee-1', { startDate: '2026-02-10', endDate: '2026-02-01', daysCount: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveSchedule.create).not.toHaveBeenCalled();
  });

  it('findAllForEmployee filters by companyId too, not just employeeId', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });

    await service.findAllForEmployee('employee-1');

    expect(prisma.leaveSchedule.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-1', companyId: 'company-1' },
      orderBy: { startDate: 'desc' },
    });
  });

  it('cancel() scopes the lookup to the current company, so a schedule from another company 404s', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue(null);
    await expect(service.cancel('schedule-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancel() flips a SCHEDULED period to CANCELLED', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({ id: 'leave-1', companyId: 'company-1', status: 'SCHEDULED' });
    prisma.leaveSchedule.update.mockResolvedValue({ id: 'leave-1', status: 'CANCELLED' });

    await service.cancel('leave-1');

    expect(prisma.leaveSchedule.update).toHaveBeenCalledWith({
      where: { id: 'leave-1' },
      data: { status: 'CANCELLED' },
    });
  });

  it('cancel() refuses an already CANCELLED period', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({ id: 'leave-1', companyId: 'company-1', status: 'CANCELLED' });

    await expect(service.cancel('leave-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.leaveSchedule.update).not.toHaveBeenCalled();
  });

  it('cancel() refuses a COMPLETED period', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({ id: 'leave-1', companyId: 'company-1', status: 'COMPLETED' });

    await expect(service.cancel('leave-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.leaveSchedule.update).not.toHaveBeenCalled();
  });

  it('resume() flips a genuinely cancelled, non-overlapping schedule back to SCHEDULED', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({
      id: 'leave-1', companyId: 'company-1', employeeId: 'employee-1', status: 'CANCELLED',
      startDate: new Date('2026-02-01'), endDate: new Date('2026-02-05'), daysCount: 5,
    });
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
    });
    prisma.leaveSchedule.update.mockResolvedValue({ id: 'leave-1', status: 'SCHEDULED' });

    await service.resume('leave-1');

    expect(prisma.leaveSchedule.update).toHaveBeenCalledWith({
      where: { id: 'leave-1' },
      data: { status: 'SCHEDULED' },
    });
  });

  it('resume() rejects a schedule that is not CANCELLED', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({
      id: 'leave-1', companyId: 'company-1', employeeId: 'employee-1', status: 'SCHEDULED',
      startDate: new Date('2026-02-01'), endDate: new Date('2026-02-05'), daysCount: 5,
    });

    await expect(service.resume('leave-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.leaveSchedule.update).not.toHaveBeenCalled();
  });

  it('resume() rejects when the employee is now INACTIVE', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({
      id: 'leave-1', companyId: 'company-1', employeeId: 'employee-1', status: 'CANCELLED',
      startDate: new Date('2026-02-01'), endDate: new Date('2026-02-05'), daysCount: 5,
    });
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'INACTIVE',
    });

    await expect(service.resume('leave-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveSchedule.update).not.toHaveBeenCalled();
  });

  it('resume() rejects when it would now overlap an active VacationSchedule', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({
      id: 'leave-1', companyId: 'company-1', employeeId: 'employee-1', status: 'CANCELLED',
      startDate: new Date('2026-02-01'), endDate: new Date('2026-02-05'), daysCount: 5,
    });
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
    });
    prisma.vacationSchedule.findMany.mockResolvedValue([
      { id: 'vacation-1', startDate: new Date('2026-02-03'), endDate: new Date('2026-02-10'), status: 'APPROVED' },
    ]);

    await expect(service.resume('leave-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveSchedule.update).not.toHaveBeenCalled();
  });

  it('resume() rejects when it would now overlap an active LeaveSchedule', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue({
      id: 'leave-1', companyId: 'company-1', employeeId: 'employee-1', status: 'CANCELLED',
      startDate: new Date('2026-02-01'), endDate: new Date('2026-02-05'), daysCount: 5,
    });
    employeesService.assertExists.mockResolvedValue({
      id: 'employee-1', companyId: 'company-1', contractType: 'CLT', status: 'ACTIVE',
    });
    prisma.leaveSchedule.findMany.mockResolvedValue([
      { id: 'other-leave', startDate: new Date('2026-02-03'), endDate: new Date('2026-02-10'), status: 'SCHEDULED' },
    ]);

    await expect(service.resume('leave-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.leaveSchedule.update).not.toHaveBeenCalled();
  });

  it('resume() scopes the lookup to the current company, so a schedule from another company 404s', async () => {
    prisma.leaveSchedule.findFirst.mockResolvedValue(null);
    await expect(service.resume('leave-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });
});
