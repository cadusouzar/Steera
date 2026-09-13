import { ForbiddenException } from '@nestjs/common';
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
    controller = new EmployeesController(service as unknown as EmployeesService);
  });

  it('allows an ADMIN to see full employee detail', async () => {
    const result = await controller.findOne('e1', { userId: 'u1', companyId: 'c1', role: 'ADMIN', modules: [] });
    expect(result.cpf).toBe('12345678900');
    expect(result.bankDetails).toBe('segredo-bancario');
  });

  it('allows an EMPLOYEE login with RH in modules to see full employee detail', async () => {
    const result = await controller.findOne('e1', {
      userId: 'u2',
      companyId: 'c1',
      role: 'EMPLOYEE',
      modules: ['RH'],
    });
    expect(result.cpf).toBe('12345678900');
  });

  it('rejects an EMPLOYEE login without RH in modules with a 403', async () => {
    await expect(
      controller.findOne('e1', { userId: 'u3', companyId: 'c1', role: 'EMPLOYEE', modules: ['DASHBOARD'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findOne).not.toHaveBeenCalled();
  });
});
