import { NotFoundException } from '@nestjs/common';
import { LeaveSchedulesController } from './leave-schedules.controller';

// Task 4 do plano "Permissões por ação e alcance": mesma regra das férias — listar usa o alcance de
// funcionarios.ver; agendar/cancelar/retomar usam o de ferias.gerenciar. Rotas por id do agendamento
// respondem com o 404 do próprio agendamento de afastamento.
describe('LeaveSchedulesController — alcance', () => {
  let service: Record<string, jest.Mock>;
  let scope: { assertEmployeeInScope: jest.Mock };
  let controller: LeaveSchedulesController;

  beforeEach(() => {
    service = {
      schedule: jest.fn().mockResolvedValue({}),
      findAllForEmployee: jest.fn().mockResolvedValue([]),
      findEmployeeIdOf: jest.fn().mockResolvedValue('e9'),
      cancel: jest.fn().mockResolvedValue({}),
      resume: jest.fn().mockResolvedValue({}),
    };
    scope = {
      assertEmployeeInScope: jest.fn(async (_code: string, employeeId: string, message?: string) => {
        throw new NotFoundException(message ?? `Funcionário ${employeeId} não encontrado`);
      }),
    };
    controller = new LeaveSchedulesController(service as never, scope as never);
  });

  it('schedule fora do alcance de ferias.gerenciar -> 404, sem escrita', async () => {
    await expect(controller.schedule('e9', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('ferias.gerenciar', 'e9');
    expect(service.schedule).not.toHaveBeenCalled();
  });

  it('findAllForEmployee fora do alcance de funcionarios.ver -> 404, sem consulta', async () => {
    await expect(controller.findAllForEmployee('e9')).rejects.toBeInstanceOf(NotFoundException);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('funcionarios.ver', 'e9');
    expect(service.findAllForEmployee).not.toHaveBeenCalled();
  });

  const idRoutes: Array<[string, (c: LeaveSchedulesController) => Promise<unknown>, string]> = [
    ['cancel', (c) => c.cancel('l1'), 'cancel'],
    ['resume', (c) => c.resume('l1'), 'resume'],
  ];

  it.each(idRoutes)('%s fora do alcance -> 404 com a mensagem do agendamento, sem escrita', async (_n, call, method) => {
    await expect(call(controller)).rejects.toThrow(new NotFoundException('Agendamento de afastamento l1 não encontrado'));
    expect(service.findEmployeeIdOf).toHaveBeenCalledWith('l1');
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('ferias.gerenciar', 'e9', 'Agendamento de afastamento l1 não encontrado');
    expect(service[method]).not.toHaveBeenCalled();
  });

  it.each(idRoutes)('%s dentro do alcance segue pro serviço', async (_n, call, method) => {
    scope.assertEmployeeInScope.mockResolvedValue(undefined);
    await call(controller);
    expect(service[method]).toHaveBeenCalled();
  });
});
