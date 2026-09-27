import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/decorators/require-permission.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { EmployeePaymentsController } from '../employee-payments/employee-payments.controller';
import { EmployeeRecurringPaymentsController } from '../employee-recurring-payments/employee-recurring-payments.controller';
import { EmployeeWarningsController } from '../employee-warnings/employee-warnings.controller';
import { LeaveSchedulesController } from '../leaves/leave-schedules.controller';
import { VacationSchedulesController } from '../vacations/vacation-schedules.controller';

// Task 4 do plano "Permissões por ação e alcance": dependentes de Funcionários. Advertências:
// leitura = funcionarios.ver, escrita = advertencias.gerenciar. Pagamentos e recorrências: TODAS as
// rotas = pagamentos.gerenciar. Férias e afastamentos: leitura = funcionarios.ver, escrita =
// ferias.gerenciar. Mesmo padrão de reflexão dos specs irmãos.
const reflector = new Reflector();

type Ctor = abstract new (...args: any[]) => unknown;

function requiredPermissions(controller: Ctor, handlerName: string): string[] | undefined {
  const proto = (controller as any).prototype;
  return reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [proto[handlerName], controller as any]);
}

function effectiveGuards(controller: Ctor, handlerName: string): unknown[] {
  const proto = (controller as any).prototype;
  const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
  const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, proto[handlerName]) ?? [];
  return [...classGuards, ...methodGuards];
}

// Todo método de ROTA do controller (com metadado de path; helpers privados ficam de fora) precisa
// aparecer no mapa (evita um handler novo sem permissão).
function handlerNames(controller: Ctor): string[] {
  const proto = (controller as any).prototype;
  return Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && typeof proto[n] === 'function' && Reflect.getMetadata(PATH_METADATA, proto[n]) !== undefined);
}

const map: Array<[Ctor, Record<string, string[]>]> = [
  [
    EmployeeWarningsController,
    {
      create: ['advertencias.gerenciar'],
      findAllForEmployee: ['funcionarios.ver'],
      findOne: ['funcionarios.ver'],
      update: ['advertencias.gerenciar'],
    },
  ],
  [
    EmployeePaymentsController,
    {
      create: ['pagamentos.gerenciar'],
      findAllForEmployee: ['pagamentos.gerenciar'],
      findOne: ['pagamentos.gerenciar'],
      update: ['pagamentos.gerenciar'],
      pay: ['pagamentos.gerenciar'],
      unpay: ['pagamentos.gerenciar'],
      remove: ['pagamentos.gerenciar'],
    },
  ],
  [
    EmployeeRecurringPaymentsController,
    {
      create: ['pagamentos.gerenciar'],
      findAllForEmployee: ['pagamentos.gerenciar'],
      findOne: ['pagamentos.gerenciar'],
      update: ['pagamentos.gerenciar'],
      remove: ['pagamentos.gerenciar'],
      generateCharge: ['pagamentos.gerenciar'],
    },
  ],
  [
    VacationSchedulesController,
    {
      schedule: ['ferias.gerenciar'],
      findAllForEmployee: ['funcionarios.ver'],
      cancel: ['ferias.gerenciar'],
      resume: ['ferias.gerenciar'],
    },
  ],
  [
    LeaveSchedulesController,
    {
      schedule: ['ferias.gerenciar'],
      findAllForEmployee: ['funcionarios.ver'],
      cancel: ['ferias.gerenciar'],
      resume: ['ferias.gerenciar'],
    },
  ],
];

describe('Mapa rota -> permissão: advertências, pagamentos, recorrências, férias e afastamentos', () => {
  describe.each(map)('%p', (controller, handlers) => {
    it('todo handler do controller está no mapa', () => {
      expect(handlerNames(controller).sort()).toEqual(Object.keys(handlers).sort());
    });

    it.each(Object.entries(handlers))('#%s exige exatamente %j, com PermissionsGuard uma vez ao lado do ModulesGuard', (handler, codes) => {
      expect(requiredPermissions(controller, handler)).toEqual(codes);
      const guards = effectiveGuards(controller, handler);
      expect(guards.filter((g) => g === PermissionsGuard)).toHaveLength(1);
      expect(guards).toContain(ModulesGuard);
    });
  });
});
