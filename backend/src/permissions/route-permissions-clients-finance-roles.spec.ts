import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ClientsController } from '../clients/clients.controller';
import { ReceivablesController } from '../receivables/receivables.controller';
import { ReportsController } from '../reports/reports.controller';
import { RolesController } from '../roles/roles.controller';
import { SubscriptionsController } from '../subscriptions/subscriptions.controller';

// Task 2 do plano "Permissões por ação e alcance": cobre o mapa rota -> permissão da spec (verbatim,
// ver task-2-brief.md) pra Clientes, Lançamentos (Receivables/Subscriptions), Relatórios e Cargos.
// Usa Reflector real (mesmo padrão de PermissionsGuard/ModulesGuard) pra resolver o efetivo
// handler-ou-classe, e Reflect.getMetadata(GUARDS_METADATA, ...) pra confirmar que PermissionsGuard
// de fato está na cadeia de guards (classe OU método) que protege cada handler.
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

function expectHandler(controller: Ctor, handlerName: string, codes: string[]) {
  it(`${controller.name}#${handlerName} requires exactly ${JSON.stringify(codes)} and is behind PermissionsGuard`, () => {
    expect(requiredPermissions(controller, handlerName)).toEqual(codes);
    expect(effectiveGuards(controller, handlerName)).toContain(PermissionsGuard);
  });
}

describe('Mapa rota -> permissão: Clientes, Lançamentos, Relatórios e Cargos', () => {
  describe('ClientsController', () => {
    expectHandler(ClientsController, 'findAll', ['clientes.ver']);
    expectHandler(ClientsController, 'findTrash', ['clientes.ver']);
    expectHandler(ClientsController, 'findOne', ['clientes.ver']);
    expectHandler(ClientsController, 'create', ['clientes.gerenciar']);
    expectHandler(ClientsController, 'update', ['clientes.gerenciar']);
    expectHandler(ClientsController, 'deactivate', ['clientes.gerenciar']);
    expectHandler(ClientsController, 'restore', ['clientes.gerenciar']);
  });

  describe('ReceivablesController', () => {
    expectHandler(ReceivablesController, 'findAllForClient', ['financas.lancamentos.ver']);
    expectHandler(ReceivablesController, 'findOne', ['financas.lancamentos.ver']);
    expectHandler(ReceivablesController, 'create', ['financas.lancamentos.gerenciar']);
    expectHandler(ReceivablesController, 'update', ['financas.lancamentos.gerenciar']);
    expectHandler(ReceivablesController, 'pay', ['financas.lancamentos.gerenciar']);
    expectHandler(ReceivablesController, 'unpay', ['financas.lancamentos.gerenciar']);
    expectHandler(ReceivablesController, 'remove', ['financas.lancamentos.gerenciar']);
  });

  describe('SubscriptionsController', () => {
    expectHandler(SubscriptionsController, 'findAllForClient', ['financas.lancamentos.ver']);
    expectHandler(SubscriptionsController, 'findOne', ['financas.lancamentos.ver']);
    expectHandler(SubscriptionsController, 'create', ['financas.lancamentos.gerenciar']);
    expectHandler(SubscriptionsController, 'update', ['financas.lancamentos.gerenciar']);
    expectHandler(SubscriptionsController, 'remove', ['financas.lancamentos.gerenciar']);
    expectHandler(SubscriptionsController, 'generateCharge', ['financas.lancamentos.gerenciar']);
  });

  describe('ReportsController', () => {
    expectHandler(ReportsController, 'financialSummary', ['financas.lancamentos.ver']);
  });

  describe('RolesController', () => {
    expectHandler(RolesController, 'findAll', ['cargos.ver']);
    expectHandler(RolesController, 'findActive', ['cargos.ver']);
    expectHandler(RolesController, 'findOne', ['cargos.ver']);
    expectHandler(RolesController, 'create', ['cargos.gerenciar']);
    expectHandler(RolesController, 'update', ['cargos.gerenciar']);
    expectHandler(RolesController, 'deactivate', ['cargos.gerenciar']);
    expectHandler(RolesController, 'reactivate', ['cargos.gerenciar']);
  });
});
