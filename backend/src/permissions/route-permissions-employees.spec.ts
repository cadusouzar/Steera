import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/decorators/require-permission.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { EmployeesController } from '../employees/employees.controller';

// Task 3 do plano "Permissões por ação e alcance": leitura de Funcionários exige
// funcionarios.ver, escrita exige funcionarios.gerenciar; as duas visões de Ponto aninhadas sob
// /employees continuam com ponto.administrar (Task 5). Mesmo padrão de reflexão dos specs irmãos.
const reflector = new Reflector();

function requiredPermissions(handlerName: string): string[] | undefined {
  const proto = EmployeesController.prototype as any;
  return reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [proto[handlerName], EmployeesController]);
}

function effectiveGuards(handlerName: string): unknown[] {
  const proto = EmployeesController.prototype as any;
  const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, EmployeesController) ?? [];
  const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, proto[handlerName]) ?? [];
  return [...classGuards, ...methodGuards];
}

describe('Mapa rota -> permissão: Funcionários', () => {
  const cases: Array<[string, string[]]> = [
    ['findAll', ['funcionarios.ver']],
    ['findOne', ['funcionarios.ver']],
    ['create', ['funcionarios.gerenciar']],
    ['update', ['funcionarios.gerenciar']],
    ['deactivate', ['funcionarios.gerenciar']],
    ['reactivate', ['funcionarios.gerenciar']],
    ['listTimeEvents', ['ponto.administrar']],
    ['timeSummary', ['ponto.administrar']],
  ];

  it.each(cases)('EmployeesController#%s requires exactly %j', (handler, codes) => {
    expect(requiredPermissions(handler)).toEqual(codes);
  });

  it.each(cases)('EmployeesController#%s runs PermissionsGuard exactly once, alongside ModulesGuard', (handler) => {
    const guards = effectiveGuards(handler);
    expect(guards.filter((g) => g === PermissionsGuard)).toHaveLength(1);
    expect(guards).toContain(ModulesGuard);
  });
});
