import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { EmployeesController } from '../employees/employees.controller';
import { HolidaysController } from '../holidays/holidays.controller';
import { TimeAdjustmentsController } from '../time-adjustments/time-adjustments.controller';
import { TimeClockController } from '../time-clock/time-clock.controller';
import { TimeEventsAdminController } from '../time-clock/time-events-admin.controller';
import { TimeJustificationsController } from '../time-justifications/time-justifications.controller';
import { TimeManagementController } from '../time-management/time-management.controller';
import { TimeTrackingSettingsController } from '../time-tracking-settings/time-tracking-settings.controller';
import { WorkLocationsController } from '../work-locations/work-locations.controller';
import { WorkSchedulesController } from '../work-schedules/work-schedules.controller';

// Task 5 do plano "Permissões por ação e alcance": todo handler com @RequireModule('PONTO_REGISTRO')
// exige ponto.registrar; todo handler com @RequireModule('PONTO_ADMINISTRACAO') exige
// ponto.administrar; em Holidays, só POST/DELETE exigem ponto.feriados.gerenciar (GET continua só
// com o módulo). Mesmo padrão de reflexão do spec irmão de Clientes/Finanças/Cargos.
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

describe('Mapa rota -> permissão: Controle de Ponto e Feriados', () => {
  describe('TimeClockController (auto-atendimento, PONTO_REGISTRO)', () => {
    expectHandler(TimeClockController, 'getStatus', ['ponto.registrar']);
    expectHandler(TimeClockController, 'createPunch', ['ponto.registrar']);
    expectHandler(TimeClockController, 'listOwnPunches', ['ponto.registrar']);
    expectHandler(TimeClockController, 'getSummary', ['ponto.registrar']);
  });

  describe('TimeEventsAdminController (PONTO_ADMINISTRACAO)', () => {
    expectHandler(TimeEventsAdminController, 'listInconsistencies', ['ponto.administrar']);
  });

  describe('TimeAdjustmentsController (misto)', () => {
    expectHandler(TimeAdjustmentsController, 'create', ['ponto.registrar']);
    expectHandler(TimeAdjustmentsController, 'listOwn', ['ponto.registrar']);
    expectHandler(TimeAdjustmentsController, 'cancel', ['ponto.registrar']);
    expectHandler(TimeAdjustmentsController, 'listForAdmin', ['ponto.administrar']);
    expectHandler(TimeAdjustmentsController, 'approve', ['ponto.administrar']);
    expectHandler(TimeAdjustmentsController, 'reject', ['ponto.administrar']);
    expectHandler(TimeAdjustmentsController, 'proactiveCorrect', ['ponto.administrar']);
  });

  describe('TimeJustificationsController (misto)', () => {
    expectHandler(TimeJustificationsController, 'create', ['ponto.registrar']);
    expectHandler(TimeJustificationsController, 'listOwn', ['ponto.registrar']);
    expectHandler(TimeJustificationsController, 'listForAdmin', ['ponto.administrar']);
    expectHandler(TimeJustificationsController, 'approve', ['ponto.administrar']);
    expectHandler(TimeJustificationsController, 'reject', ['ponto.administrar']);
  });

  describe('TimeManagementController (PONTO_ADMINISTRACAO)', () => {
    expectHandler(TimeManagementController, 'listManageableEmployees', ['ponto.administrar']);
    expectHandler(TimeManagementController, 'hasDirectReports', ['ponto.administrar']);
  });

  describe('TimeTrackingSettingsController (PONTO_ADMINISTRACAO)', () => {
    expectHandler(TimeTrackingSettingsController, 'findOne', ['ponto.administrar']);
    expectHandler(TimeTrackingSettingsController, 'update', ['ponto.administrar']);
  });

  describe('WorkLocationsController (PONTO_ADMINISTRACAO)', () => {
    expectHandler(WorkLocationsController, 'create', ['ponto.administrar']);
    expectHandler(WorkLocationsController, 'findAll', ['ponto.administrar']);
    expectHandler(WorkLocationsController, 'findOne', ['ponto.administrar']);
    expectHandler(WorkLocationsController, 'update', ['ponto.administrar']);
    expectHandler(WorkLocationsController, 'remove', ['ponto.administrar']);
  });

  describe('WorkSchedulesController (PONTO_ADMINISTRACAO)', () => {
    expectHandler(WorkSchedulesController, 'create', ['ponto.administrar']);
    expectHandler(WorkSchedulesController, 'findAll', ['ponto.administrar']);
    expectHandler(WorkSchedulesController, 'findOne', ['ponto.administrar']);
    expectHandler(WorkSchedulesController, 'update', ['ponto.administrar']);
    expectHandler(WorkSchedulesController, 'remove', ['ponto.administrar']);
  });

  describe('HolidaysController (GET continua só com o módulo; POST/DELETE exigem a permissão)', () => {
    expectHandler(HolidaysController, 'create', ['ponto.feriados.gerenciar']);
    expectHandler(HolidaysController, 'remove', ['ponto.feriados.gerenciar']);

    it('HolidaysController#findAll (GET) has no @RequirePermission — module gate only', () => {
      expect(requiredPermissions(HolidaysController, 'findAll')).toBeUndefined();
    });
  });

  describe('EmployeesController — só as duas rotas de ponto aninhadas (Task 5 não toca no resto do controller)', () => {
    expectHandler(EmployeesController, 'listTimeEvents', ['ponto.administrar']);
    expectHandler(EmployeesController, 'timeSummary', ['ponto.administrar']);
  });
});
