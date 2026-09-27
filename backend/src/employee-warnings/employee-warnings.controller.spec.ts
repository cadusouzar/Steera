import { NotFoundException } from '@nestjs/common';
import { EmployeeWarningsController } from './employee-warnings.controller';

// Task 4 do plano "Permissões por ação e alcance": todas as rotas de advertência são aninhadas sob
// employees/:employeeId, então o alcance é checado direto nesse employeeId ANTES do serviço. Leitura
// usa o alcance de funcionarios.ver; escrita, o de advertencias.gerenciar.
describe('EmployeeWarningsController — alcance', () => {
  const outOfScope = new NotFoundException('Funcionário e9 não encontrado');
  let service: Record<string, jest.Mock>;
  let scope: { assertEmployeeInScope: jest.Mock };
  let controller: EmployeeWarningsController;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'w1' }),
      findAllForEmployee: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'w1' }),
      update: jest.fn().mockResolvedValue({ id: 'w1' }),
    };
    scope = { assertEmployeeInScope: jest.fn().mockRejectedValue(outOfScope) };
    controller = new EmployeeWarningsController(service as never, scope as never);
  });

  it('create fora do alcance de advertencias.gerenciar -> 404, sem escrita', async () => {
    await expect(controller.create('e9', {} as never)).rejects.toBe(outOfScope);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('advertencias.gerenciar', 'e9');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('findAllForEmployee fora do alcance de funcionarios.ver -> 404, sem consulta', async () => {
    await expect(controller.findAllForEmployee('e9')).rejects.toBe(outOfScope);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('funcionarios.ver', 'e9');
    expect(service.findAllForEmployee).not.toHaveBeenCalled();
  });

  it('findOne fora do alcance de funcionarios.ver -> 404, sem consulta', async () => {
    await expect(controller.findOne('e9', 'w1')).rejects.toBe(outOfScope);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('funcionarios.ver', 'e9');
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('update fora do alcance de advertencias.gerenciar -> 404, sem escrita', async () => {
    await expect(controller.update('e9', 'w1', {} as never)).rejects.toBe(outOfScope);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith('advertencias.gerenciar', 'e9');
    expect(service.update).not.toHaveBeenCalled();
  });

  it('dentro do alcance segue pro serviço', async () => {
    scope.assertEmployeeInScope.mockResolvedValue(undefined);
    await controller.create('e1', { reason: 'x' } as never);
    await controller.findAllForEmployee('e1');
    await controller.findOne('e1', 'w1');
    await controller.update('e1', 'w1', {} as never);
    expect(service.create).toHaveBeenCalledWith('e1', { reason: 'x' });
    expect(service.findAllForEmployee).toHaveBeenCalledWith('e1');
    expect(service.findOne).toHaveBeenCalledWith('w1', 'e1');
    expect(service.update).toHaveBeenCalledWith('w1', 'e1', {});
  });
});
