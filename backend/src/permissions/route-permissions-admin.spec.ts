import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomFieldsController } from '../custom-fields/custom-fields.controller';
import { ProfilesController } from '../profiles/profiles.controller';
import { UsersController } from '../users/users.controller';

// Task 6 do plano "Permissões por ação e alcance": Usuários e Perfis passam a exigir
// usuarios.gerenciar (inclusive as leituras); definições de Campos Personalizados exigem
// campos-personalizados.gerenciar, exceto a leitura das definições ativas (livre pra qualquer
// login, usada pra montar formulários). Nenhum @Roles('ADMIN') sobra nesses controllers.
const reflector = new Reflector();

type Ctor = abstract new (...args: any[]) => unknown;

function requiredPermissions(controller: Ctor, handlerName: string): string[] | undefined {
  const proto = (controller as any).prototype;
  return reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [proto[handlerName], controller as any]);
}

function requiredRoles(controller: Ctor, handlerName: string): string[] | undefined {
  const proto = (controller as any).prototype;
  return reflector.getAllAndOverride<string[]>('roles', [proto[handlerName], controller as any]);
}

function effectiveGuards(controller: Ctor, handlerName: string): unknown[] {
  const proto = (controller as any).prototype;
  const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
  const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, proto[handlerName]) ?? [];
  return [...classGuards, ...methodGuards];
}

function expectHandler(controller: Ctor, handlerName: string, codes: string[]) {
  it(`${controller.name}#${handlerName} requires exactly ${JSON.stringify(codes)}, is behind PermissionsGuard and has no @Roles`, () => {
    expect(requiredPermissions(controller, handlerName)).toEqual(codes);
    expect(effectiveGuards(controller, handlerName)).toContain(PermissionsGuard);
    expect(requiredRoles(controller, handlerName)).toBeUndefined();
  });
}

describe('Mapa rota -> permissão: Usuários, Perfis e Campos Personalizados', () => {
  describe('UsersController (usuarios.gerenciar em todas as rotas)', () => {
    for (const handler of ['findAll', 'create', 'block', 'unblock', 'remove', 'resetPassword', 'resendInvite', 'assignProfile', 'linkEmployee', 'linkableEmployees']) {
      expectHandler(UsersController, handler, ['usuarios.gerenciar']);
    }

    // A rota estática precisa ser declarada antes de qualquer rota `:id`, senão o Nest a captura como id.
    it('UsersController#linkableEmployees is GET linkable-employees, declared before every :id route', () => {
      const proto = (UsersController as any).prototype;
      const names = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
      expect(Reflect.getMetadata('path', proto.linkableEmployees)).toBe('linkable-employees');
      expect(Reflect.getMetadata('method', proto.linkableEmployees)).toBe(0); // RequestMethod.GET
      const firstParamRoute = names.findIndex((n) => String(Reflect.getMetadata('path', proto[n])).startsWith(':id'));
      expect(names.indexOf('linkableEmployees')).toBeLessThan(firstParamRoute);
    });

    it('UsersController#linkEmployee is PATCH :id/employee', () => {
      const proto = (UsersController as any).prototype;
      expect(Reflect.getMetadata('path', proto.linkEmployee)).toBe(':id/employee');
      expect(Reflect.getMetadata('method', proto.linkEmployee)).toBe(4); // RequestMethod.PATCH
    });

    it('UsersController no longer uses RolesGuard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, UsersController)).not.toContain(RolesGuard);
    });
  });

  describe('ProfilesController (usuarios.gerenciar em todas as rotas)', () => {
    for (const handler of ['getCatalog', 'findAll', 'findOne', 'create', 'update', 'remove', 'reassignAndDelete']) {
      expectHandler(ProfilesController, handler, ['usuarios.gerenciar']);
    }

    it('ProfilesController no longer uses RolesGuard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, ProfilesController)).not.toContain(RolesGuard);
    });
  });

  describe('CustomFieldsController (campos-personalizados.gerenciar, exceto a leitura das ativas)', () => {
    for (const handler of ['findAll', 'create', 'update', 'deactivate', 'activate', 'filledCount', 'optionUsage', 'remove']) {
      expectHandler(CustomFieldsController, handler, ['campos-personalizados.gerenciar']);
    }

    it('CustomFieldsController#findActive stays free for any login (no permission, no role)', () => {
      expect(requiredPermissions(CustomFieldsController, 'findActive')).toBeUndefined();
      expect(requiredRoles(CustomFieldsController, 'findActive')).toBeUndefined();
    });

    it('CustomFieldsController no longer uses RolesGuard', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, CustomFieldsController)).not.toContain(RolesGuard);
    });
  });
});
