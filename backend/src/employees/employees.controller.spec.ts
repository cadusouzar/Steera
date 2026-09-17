import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

// GET /employees/:id devolve dado LGPD-sensível completo (CPF, dados
// bancários, salário) — cobertura da checagem inline adicionada no fix "GET
// /employees/:id expõe dado LGPD-sensível sem restrição" (ver
// employees.controller.ts). Testado no nível do controller (não do service)
// porque a checagem em si vive no controller.
describe('EmployeesController#findOne', () => {
  const fakeEmployee = {
    id: 'e1',
    fullName: 'Fulano de Tal',
    cpf: '12345678900',
    roleId: 'r1',
    email: null,
    phone: null,
    address: null,
    contractType: 'CLT',
    admissionDate: new Date(),
    terminationDate: null,
    status: 'ACTIVE',
    department: null,
    baseValue: 1000 as any,
    paymentDueDay: 5,
    payOnLastBusinessDay: false,
    bankDetails: 'segredo-bancario',
    salaryRecurrenceEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let controller: EmployeesController;
  let service: { findOne: jest.Mock };

  beforeEach(() => {
    service = { findOne: jest.fn().mockResolvedValue(fakeEmployee) };
    // Os 3 argumentos extras (Task 10 — visões agregadas de ponto) não são exercitados por este
    // describe (só testa findOne(), que não os usa); undefined basta.
    controller = new EmployeesController(
      service as unknown as EmployeesService,
      undefined as never,
      undefined as never,
      undefined as never,
    );
  });

  it('allows an ADMIN to see full employee detail', async () => {
    const result = await controller.findOne('e1', {
      userId: 'u1',
      companyId: 'c1',
      role: 'ADMIN',
      modules: [],
      mustChangePassword: false,
      hasFullPontoAccess: true,
    });
    expect(result.cpf).toBe('12345678900');
    expect(result.bankDetails).toBe('segredo-bancario');
  });

  it('allows an EMPLOYEE login with RH_FUNCIONARIOS in modules to see full employee detail', async () => {
    const result = await controller.findOne('e1', {
      userId: 'u2',
      companyId: 'c1',
      role: 'EMPLOYEE',
      modules: ['RH_FUNCIONARIOS'],
      mustChangePassword: false,
      hasFullPontoAccess: true,
    });
    expect(result.cpf).toBe('12345678900');
  });

  it('rejects an EMPLOYEE login without RH_FUNCIONARIOS in modules with a 403', async () => {
    await expect(
      controller.findOne('e1', {
        userId: 'u3',
        companyId: 'c1',
        role: 'EMPLOYEE',
        modules: ['DASHBOARD'],
        mustChangePassword: false,
        hasFullPontoAccess: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findOne).not.toHaveBeenCalled();
  });
});

// Visões administrativas agregadas de ponto (Task 10) — confirma que o controller checa
// assertCanManage() ANTES de delegar pro serviço (nunca deixa o serviço ser a única linha de
// defesa), e que a validação de year/month é a mesma do TimeClockController (Task 7).
describe('EmployeesController — aggregated time-tracking admin views', () => {
  let controller: EmployeesController;
  let timeManagementAuth: { assertCanManage: jest.Mock };
  let timeClock: { listForEmployeeAdmin: jest.Mock };
  let calculation: { calculateMonthlySummary: jest.Mock };

  const user: AuthenticatedUser = { userId: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['RH_FUNCIONARIOS'], mustChangePassword: false, hasFullPontoAccess: true };

  beforeEach(() => {
    timeManagementAuth = { assertCanManage: jest.fn().mockResolvedValue(undefined) };
    timeClock = { listForEmployeeAdmin: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }) };
    calculation = { calculateMonthlySummary: jest.fn().mockResolvedValue({ days: [], totals: {} }) };
    controller = new EmployeesController(
      undefined as never,
      timeManagementAuth as never,
      timeClock as never,
      calculation as never,
    );
  });

  describe('listTimeEvents', () => {
    it('checks assertCanManage BEFORE delegating to TimeClockService', async () => {
      await controller.listTimeEvents('employee-1', user, {});
      expect(timeManagementAuth.assertCanManage).toHaveBeenCalledWith(user, 'employee-1');
      expect(timeClock.listForEmployeeAdmin).toHaveBeenCalledWith(user, 'employee-1', {});
    });

    it('propagates the 404 from assertCanManage without ever calling the service', async () => {
      timeManagementAuth.assertCanManage.mockRejectedValue(new NotFoundException('não encontrado'));
      await expect(controller.listTimeEvents('employee-1', user, {})).rejects.toBeInstanceOf(NotFoundException);
      expect(timeClock.listForEmployeeAdmin).not.toHaveBeenCalled();
    });
  });

  describe('timeSummary', () => {
    it('checks assertCanManage before delegating, then calls calculateMonthlySummary with numeric year/month', async () => {
      await controller.timeSummary('employee-1', user, '2026', '9');
      expect(timeManagementAuth.assertCanManage).toHaveBeenCalledWith(user, 'employee-1');
      expect(calculation.calculateMonthlySummary).toHaveBeenCalledWith('employee-1', 2026, 9);
    });

    it('rejects invalid year/month with a clean 400, never reaching the calculation service', async () => {
      await expect(controller.timeSummary('employee-1', user, 'abc', '13')).rejects.toBeInstanceOf(BadRequestException);
      expect(calculation.calculateMonthlySummary).not.toHaveBeenCalled();
    });

    it('propagates the 404 from assertCanManage without ever calling the calculation service', async () => {
      timeManagementAuth.assertCanManage.mockRejectedValue(new NotFoundException('não encontrado'));
      await expect(controller.timeSummary('employee-1', user, '2026', '9')).rejects.toBeInstanceOf(NotFoundException);
      expect(calculation.calculateMonthlySummary).not.toHaveBeenCalled();
    });
  });
});
