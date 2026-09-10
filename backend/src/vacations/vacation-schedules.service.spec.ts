import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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

  it('cancel() scopes the lookup to the current company, so a schedule from another company 404s', async () => {
    prisma.vacationSchedule.findFirst.mockResolvedValue(null);
    await expect(service.cancel('schedule-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });
});
