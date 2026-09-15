// Toda tabela que representa dado operacional de UMA empresa só — fonte única de verdade pra
// classificar cada comando SQL de uma migration como "central" (ignorado ao gerar o histórico de
// tenant) ou "de tenant" (replicado). `Holiday` fica de fora de propósito: seus escopos
// NATIONAL/STATE são um catálogo compartilhado por todo o sistema, e o volume/risco de escopos
// COMPANY é baixo o suficiente pra não justificar, nesta fase, o isolamento físico — o
// companyId+RLS que já existe hoje já cobre esse caso corretamente. `Company`/`User`/
// `RefreshToken`/`TenantMigration` nunca entram aqui — são as tabelas centrais.
export const TENANT_TABLE_NAMES = [
  'Client',
  'Receivable',
  'Subscription',
  'Role',
  'Employee',
  'EmployeeWarning',
  'EmployeeRecurringPayment',
  'EmployeePayment',
  'VacationSchedule',
  'LeaveSchedule',
  'TimeTrackingSettings',
  'TimeEvent',
  'WorkSchedule',
  'WorkLocation',
  'TimeAdjustmentRequest',
  'TimeCorrection',
  'TimeJustification',
  'FileAsset',
  'AuditLog',
] as const;
