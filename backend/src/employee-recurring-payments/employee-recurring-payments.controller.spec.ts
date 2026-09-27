import { NotFoundException } from '@nestjs/common';
import { EmployeeRecurringPaymentsController } from './employee-recurring-payments.controller';

// Task 4 do plano "Permissões por ação e alcance": mesma regra dos pagamentos avulsos — toda rota
// usa o alcance de pagamentos.gerenciar; rotas por id da recorrência respondem com o 404 da própria
// recorrência quando o funcionário dono está fora do alcance.
describe('EmployeeRecurringPaymentsController — alcance de pagamentos.gerenciar', () => {
  const CODE = 'pagamentos.gerenciar';
  let service: Record<string, jest.Mock>;
  let scope: { assertEmployeeInScope: jest.Mock };
  let controller: EmployeeRecurringPaymentsController;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({}),
      findAllForEmployee: jest.fn().mockResolvedValue([]),
      findEmployeeIdOf: jest.fn().mockResolvedValue('e9'),
      findOne: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
      generateCharge: jest.fn().mockResolvedValue({}),
    };
    scope = {
      assertEmployeeInScope: jest.fn(async (_code: string, employeeId: string, message?: string) => {
        throw new NotFoundException(message ?? `Funcionário ${employeeId} não encontrado`);
      }),
    };
    controller = new EmployeeRecurringPaymentsController(service as never, scope as never);
  });

  it('create fora do alcance -> 404, sem escrita', async () => {
    await expect(controller.create('e9', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith(CODE, 'e9');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('findAllForEmployee fora do alcance -> 404, sem consulta', async () => {
    await expect(controller.findAllForEmployee('e9')).rejects.toBeInstanceOf(NotFoundException);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith(CODE, 'e9');
    expect(service.findAllForEmployee).not.toHaveBeenCalled();
  });

  const idRoutes: Array<[string, (c: EmployeeRecurringPaymentsController) => Promise<unknown>, string]> = [
    ['findOne', (c) => c.findOne('r1'), 'findOne'],
    ['update', (c) => c.update('r1', {} as never), 'update'],
    ['remove', (c) => c.remove('r1'), 'remove'],
    ['generateCharge', (c) => c.generateCharge('r1'), 'generateCharge'],
  ];

  it.each(idRoutes)('%s fora do alcance -> 404 com a mensagem da recorrência, sem tocar o registro', async (_n, call, method) => {
    await expect(call(controller)).rejects.toThrow(new NotFoundException('Recorrência r1 não encontrada'));
    expect(service.findEmployeeIdOf).toHaveBeenCalledWith('r1');
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith(CODE, 'e9', 'Recorrência r1 não encontrada');
    expect(service[method]).not.toHaveBeenCalled();
  });

  it.each(idRoutes)('%s dentro do alcance segue pro serviço', async (_n, call, method) => {
    scope.assertEmployeeInScope.mockResolvedValue(undefined);
    await call(controller);
    expect(service[method]).toHaveBeenCalled();
  });
});
