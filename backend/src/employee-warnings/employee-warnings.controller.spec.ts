import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmployeeWarningsController } from './employee-warnings.controller';

// Task 4 do plano "Permissões por ação e alcance": todas as rotas de advertência são aninhadas sob
// employees/:employeeId, então o alcance é checado direto nesse employeeId ANTES do serviço. Leitura
// usa o alcance de funcionarios.ver; escrita, o de advertencias.gerenciar.
describe('EmployeeWarningsController — alcance', () => {
  const outOfScope = new NotFoundException('Funcionário e9 não encontrado');
  let service: Record<string, jest.Mock>;
  let scope: { assertEmployeeInScope: jest.Mock; assertCanWriteOwn: jest.Mock };
  let controller: EmployeeWarningsController;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'w1' }),
      findAllForEmployee: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'w1' }),
      update: jest.fn().mockResolvedValue({ id: 'w1' }),
    };
    scope = { assertEmployeeInScope: jest.fn().mockRejectedValue(outOfScope), assertCanWriteOwn: jest.fn().mockResolvedValue(undefined) };
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

// "Pode alterar os próprios dados?" (28/09/2026): toda ESCRITA checa o alcance primeiro (404) e, só
// dentro do alcance, assertCanWriteOwn (403 quando o alvo é a própria ficha sem
// funcionarios.proprios.gerenciar). Recusado -> nenhuma escrita no serviço.
describe('EmployeeWarningsController — próprios dados', () => {
  const OWN_MSG = 'Seu perfil não permite alterar os próprios dados. Fale com quem administra os acessos da empresa.';
  let service: Record<string, jest.Mock>;
  let calls: string[];
  let scope: { assertEmployeeInScope: jest.Mock; assertCanWriteOwn: jest.Mock };
  let controller: EmployeeWarningsController;

  beforeEach(() => {
    calls = [];
    service = {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
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
    controller = new EmployeeWarningsController(service as never, scope as never);
  });

  const writeRoutes: Array<[string, (c: EmployeeWarningsController) => Promise<unknown>, string, string]> = [
    ['create', (c) => c.create('e1', {} as never), 'create', 'e1'],
    ['update', (c) => c.update('e1', 'w1', {} as never), 'update', 'e1'],
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
