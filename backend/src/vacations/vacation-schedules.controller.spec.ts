import { NotFoundException } from '@nestjs/common';
import { VacationSchedulesController } from './vacation-schedules.controller';

// Task 4 do plano "Permissões por ação e alcance": listar férias usa o alcance de funcionarios.ver;
// agendar/cancelar/retomar usam o de ferias.gerenciar. Rotas por id do agendamento respondem com o
// 404 do próprio agendamento quando o funcionário dono está fora do alcance.
describe('VacationSchedulesController — alcance', () => {
  let service: Record<string, jest.Mock>;
  let scope: { assertEmployeeInScope: jest.Mock };
  let controller: VacationSchedulesController;

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
    controller = new VacationSchedulesController(service as never, scope as never);
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

  const idRoutes: Array<[string, (c: VacationSchedulesController) => Promise<unknown>, string]> = [
    ['cancel', (c) => c.cancel('v1'), 'cancel'],
    ['resume', (c) => c.resume('v1', {} as never), 'resume'],
  ];

  it.each(idRoutes)('%s fora do alcance -> 404 com a mensagem do agendamento, sem escrita', async (_n, call, method) => {
    await expect(call(controller)).rejects.toThrow(new NotFoundException('Agendamento de férias v1 não encontrado'));
    expect(service.findEmployeeIdOf).toHaveBeenCalledWith('v1');
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('ferias.gerenciar', 'e9', 'Agendamento de férias v1 não encontrado');
    expect(service[method]).not.toHaveBeenCalled();
  });

  it.each(idRoutes)('%s dentro do alcance segue pro serviço', async (_n, call, method) => {
    scope.assertEmployeeInScope.mockResolvedValue(undefined);
    await call(controller);
    expect(service[method]).toHaveBeenCalled();
  });

  it('schedule e findAllForEmployee dentro do alcance seguem pro serviço', async () => {
    scope.assertEmployeeInScope.mockResolvedValue(undefined);
    await controller.schedule('e1', {} as never);
    await controller.findAllForEmployee('e1');
    expect(service.schedule).toHaveBeenCalledWith('e1', {});
    expect(service.findAllForEmployee).toHaveBeenCalledWith('e1');
  });
});
