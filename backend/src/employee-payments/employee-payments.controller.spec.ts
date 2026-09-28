import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmployeePaymentsController } from './employee-payments.controller';

// Task 4 do plano "Permissões por ação e alcance": toda rota de pagamento usa o alcance de
// pagamentos.gerenciar. Aninhadas: checa o employeeId da URL. Por id do pagamento: descobre o dono
// do registro (findEmployeeIdOf) e checa o alcance com a mensagem de 404 do PRÓPRIO pagamento.
describe('EmployeePaymentsController — alcance de pagamentos.gerenciar', () => {
  const CODE = 'pagamentos.gerenciar';
  let service: Record<string, jest.Mock>;
  let scope: { assertEmployeeInScope: jest.Mock; assertCanWriteOwn: jest.Mock };
  let controller: EmployeePaymentsController;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({}),
      findAllForEmployee: jest.fn().mockResolvedValue({ items: [] }),
      findEmployeeIdOf: jest.fn().mockResolvedValue('e9'),
      findOne: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      pay: jest.fn().mockResolvedValue({}),
      unpay: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
    };
    scope = {
      assertCanWriteOwn: jest.fn().mockResolvedValue(undefined),
      assertEmployeeInScope: jest.fn(async (_code: string, employeeId: string, message?: string) => {
        throw new NotFoundException(message ?? `Funcionário ${employeeId} não encontrado`);
      }),
    };
    controller = new EmployeePaymentsController(service as never, scope as never);
  });

  it('create fora do alcance -> 404 de funcionário, sem escrita', async () => {
    await expect(controller.create('e9', {} as never)).rejects.toThrow(new NotFoundException('Funcionário e9 não encontrado'));
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith(CODE, 'e9');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('findAllForEmployee fora do alcance -> 404, sem consulta', async () => {
    await expect(controller.findAllForEmployee('e9', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith(CODE, 'e9');
    expect(service.findAllForEmployee).not.toHaveBeenCalled();
  });

  const idRoutes: Array<[string, (c: EmployeePaymentsController) => Promise<unknown>, string]> = [
    ['findOne', (c) => c.findOne('p1'), 'findOne'],
    ['update', (c) => c.update('p1', {} as never), 'update'],
    ['pay', (c) => c.pay('p1'), 'pay'],
    ['unpay', (c) => c.unpay('p1'), 'unpay'],
    ['remove', (c) => c.remove('p1'), 'remove'],
  ];

  it.each(idRoutes)('%s fora do alcance -> 404 com a mensagem do pagamento, sem tocar o registro', async (_n, call, method) => {
    await expect(call(controller)).rejects.toThrow(new NotFoundException('Pagamento p1 não encontrado'));
    expect(service.findEmployeeIdOf).toHaveBeenCalledWith('p1');
    expect(scope.assertEmployeeInScope).toHaveBeenCalledWith(CODE, 'e9', 'Pagamento p1 não encontrado');
    expect(service[method]).not.toHaveBeenCalled();
  });

  it.each(idRoutes)('%s dentro do alcance segue pro serviço', async (_n, call, method) => {
    scope.assertEmployeeInScope.mockResolvedValue(undefined);
    await call(controller);
    expect(service[method]).toHaveBeenCalled();
  });
});

// "Pode alterar os próprios dados?" (28/09/2026): toda ESCRITA checa o alcance primeiro (404) e, só
// dentro do alcance, assertCanWriteOwn (403 quando o alvo é a própria ficha sem
// funcionarios.proprios.gerenciar). Recusado -> nenhuma escrita no serviço.
describe('EmployeePaymentsController — próprios dados', () => {
  const OWN_MSG = 'Seu perfil não permite alterar os próprios dados. Fale com quem administra os acessos da empresa.';
  let service: Record<string, jest.Mock>;
  let calls: string[];
  let scope: { assertEmployeeInScope: jest.Mock; assertCanWriteOwn: jest.Mock };
  let controller: EmployeePaymentsController;

  beforeEach(() => {
    calls = [];
    service = {
      findEmployeeIdOf: jest.fn().mockResolvedValue('e1'),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      pay: jest.fn().mockResolvedValue({}),
      unpay: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
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
    controller = new EmployeePaymentsController(service as never, scope as never);
  });

  const writeRoutes: Array<[string, (c: EmployeePaymentsController) => Promise<unknown>, string, string]> = [
    ['create', (c) => c.create('e1', {} as never), 'create', 'e1'],
    ['update', (c) => c.update('p1', {} as never), 'update', 'e1'],
    ['pay', (c) => c.pay('p1'), 'pay', 'e1'],
    ['unpay', (c) => c.unpay('p1'), 'unpay', 'e1'],
    ['remove', (c) => c.remove('p1'), 'remove', 'e1'],
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
