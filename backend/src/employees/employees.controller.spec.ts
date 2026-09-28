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
      { assertEmployeeInScope: jest.fn().mockResolvedValue(undefined), assertCanWriteOwn: jest.fn().mockResolvedValue(undefined) } as never,
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
      permissions: {},
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
      permissions: {},
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
        permissions: {},
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

  const user: AuthenticatedUser = { userId: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['RH_FUNCIONARIOS'], mustChangePassword: false, hasFullPontoAccess: true, permissions: {} };

  beforeEach(() => {
    timeManagementAuth = { assertCanManage: jest.fn().mockResolvedValue(undefined) };
    timeClock = { listForEmployeeAdmin: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }) };
    calculation = { calculateMonthlySummary: jest.fn().mockResolvedValue({ days: [], totals: {} }) };
    controller = new EmployeesController(
      undefined as never,
      timeManagementAuth as never,
      timeClock as never,
      calculation as never,
      undefined as never,
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

// Task 3 do plano "Permissões por ação e alcance": o alcance de funcionarios.ver/gerenciar é
// aplicado AQUI, na entrada HTTP, e nunca dentro de EmployeesService (que também é chamado por
// outros módulos com suas próprias permissões). O EmployeeScopeService é mockado; a resolução real
// de PROPRIO/EQUIPE/DEPARTAMENTO/EMPRESA já tem cobertura própria.
describe('EmployeesController — alcance de funcionarios.ver/gerenciar', () => {
  const user: AuthenticatedUser = {
    userId: 'u1', companyId: 'c1', role: 'EMPLOYEE', modules: ['RH_FUNCIONARIOS'],
    mustChangePassword: false, hasFullPontoAccess: false,
    permissions: { 'funcionarios.ver': 'EQUIPE', 'funcionarios.gerenciar': 'EQUIPE' },
  };
  const outOfScope = new NotFoundException('Funcionário e9 não encontrado');

  let controller: EmployeesController;
  let service: Record<string, jest.Mock>;
  let scope: { whereEmployeeIn: jest.Mock; assertEmployeeInScope: jest.Mock; assertCanWriteOwn: jest.Mock };

  beforeEach(() => {
    service = {
      findAll: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      findOne: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      reactivate: jest.fn(),
    };
    scope = {
      whereEmployeeIn: jest.fn().mockResolvedValue({ id: { in: ['e1', 'e2'] } }),
      assertEmployeeInScope: jest.fn().mockRejectedValue(outOfScope),
      assertCanWriteOwn: jest.fn().mockResolvedValue(undefined),
    };
    controller = new EmployeesController(
      service as unknown as EmployeesService,
      undefined as never,
      undefined as never,
      undefined as never,
      scope as never,
    );
  });

  it('findAll passa pro serviço o filtro de alcance de funcionarios.ver', async () => {
    await controller.findAll({});
    expect(scope.whereEmployeeIn).toHaveBeenCalledWith('funcionarios.ver');
    expect(service.findAll).toHaveBeenCalledWith({}, { id: { in: ['e1', 'e2'] } });
  });

  it('findAll com alcance EMPRESA (filtro vazio) não restringe ids', async () => {
    scope.whereEmployeeIn.mockResolvedValue({});
    await controller.findAll({});
    expect(service.findAll).toHaveBeenCalledWith({}, {});
  });

  it('findOne fora do alcance de funcionarios.ver -> 404, sem consultar o serviço', async () => {
    await expect(controller.findOne('e9', user)).rejects.toBe(outOfScope);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('funcionarios.ver', 'e9');
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('update fora do alcance de funcionarios.gerenciar -> 404, sem escrita', async () => {
    await expect(controller.update('e9', {})).rejects.toBe(outOfScope);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('funcionarios.gerenciar', 'e9');
    expect(service.update).not.toHaveBeenCalled();
  });

  it('deactivate fora do alcance de funcionarios.gerenciar -> 404, sem escrita', async () => {
    await expect(controller.deactivate('e9')).rejects.toBe(outOfScope);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('funcionarios.gerenciar', 'e9');
    expect(service.deactivate).not.toHaveBeenCalled();
  });

  it('reactivate fora do alcance de funcionarios.gerenciar -> 404, sem escrita', async () => {
    await expect(controller.reactivate('e9')).rejects.toBe(outOfScope);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('funcionarios.gerenciar', 'e9');
    expect(service.reactivate).not.toHaveBeenCalled();
  });

  it('update dentro do alcance chama o serviço normalmente', async () => {
    scope.assertEmployeeInScope.mockResolvedValue(undefined);
    service.update.mockResolvedValue({ id: 'e1', baseValue: 1000, customFields: {} });
    await controller.update('e1', {});
    expect(service.update).toHaveBeenCalledWith('e1', {});
  });
});

// "Pode alterar os próprios dados?" (28/09/2026): toda ESCRITA checa o alcance primeiro (404) e, só
// dentro do alcance, assertCanWriteOwn (403 quando o alvo é a própria ficha sem
// funcionarios.proprios.gerenciar). Recusado -> nenhuma escrita no serviço.
describe('EmployeesController — próprios dados', () => {
  const OWN_MSG = 'Seu perfil não permite alterar os próprios dados. Fale com quem administra os acessos da empresa.';
  let service: Record<string, jest.Mock>;
  let calls: string[];
  let scope: { assertEmployeeInScope: jest.Mock; assertCanWriteOwn: jest.Mock };
  let controller: EmployeesController;

  beforeEach(() => {
    calls = [];
    service = {
      update: jest.fn().mockResolvedValue({}),
      deactivate: jest.fn().mockResolvedValue({}),
      reactivate: jest.fn().mockResolvedValue({}),
    };
    scope = {
      assertEmployeeInScope: jest.fn(async () => {
        calls.push('scope');
      }),
      assertCanWriteOwn: jest.fn(async () => {
        calls.push('own');
        throw new ForbiddenException({ statusCode: 403, code: 'PERMISSION_REQUIRED', message: OWN_MSG });
      }),
    };
    controller = new EmployeesController(service as never, undefined as never, undefined as never, undefined as never, scope as never);
  });

  const writeRoutes: Array<[string, (c: EmployeesController) => Promise<unknown>, string, string]> = [
    ['update', (c) => c.update('e1', {} as never), 'update', 'e1'],
    ['deactivate', (c) => c.deactivate('e1'), 'deactivate', 'e1'],
    ['reactivate', (c) => c.reactivate('e1'), 'reactivate', 'e1'],
  ];

  it.each(writeRoutes)('%s na própria ficha sem a permissão -> 403 exato depois do alcance, sem escrita', async (_n, call, method, employeeId) => {
    const error = await call(controller).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({ statusCode: 403, code: 'PERMISSION_REQUIRED', message: OWN_MSG });
    expect(calls).toEqual(['scope', 'own']);
    expect(scope.assertCanWriteOwn).toHaveBeenCalledWith(employeeId);
    expect(service[method]).not.toHaveBeenCalled();
  });

  it.each(writeRoutes)('%s fora do alcance -> 404 sem chegar na checagem de próprios dados', async (_n, call, method) => {
    scope.assertEmployeeInScope.mockRejectedValue(new NotFoundException('fora'));
    await expect(call(controller)).rejects.toBeInstanceOf(NotFoundException);
    expect(scope.assertCanWriteOwn).not.toHaveBeenCalled();
    expect(service[method]).not.toHaveBeenCalled();
  });

  it.each(writeRoutes)('%s liberado pela checagem de próprios dados segue pro serviço', async (_n, call, method) => {
    scope.assertCanWriteOwn.mockResolvedValue(undefined);
    await call(controller);
    expect(service[method]).toHaveBeenCalled();
  });
});
