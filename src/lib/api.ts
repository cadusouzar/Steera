const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || `Erro ${res.status} ao chamar ${path}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- Shapes returned by the backend ----
interface ApiClient {
  id: string;
  name: string;
  category: string | null;
  contact: string;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  includeInRevenueReport: boolean;
  deactivatedAt: string | null;
  totalPaid?: number | string;
  totalPending?: number | string;
  totalOverdue?: number | string;
}
interface ApiReceivable {
  id: string;
  description: string;
  amount: number | string;
  dueDate: string;
  derivedStatus: 'pending' | 'paid' | 'overdue';
  subscriptionId?: string | null;
  referenceYear?: number | null;
  referenceMonth?: number | null;
}
interface ApiSubscription {
  id: string;
  description: string;
  amount: number | string;
  dueDay: number;
  status: 'ACTIVE' | 'INACTIVE';
}
interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
interface ApiFinancialSummary {
  totalPaid: number | string;
  totalPending: number | string;
  totalOverdue: number | string;
  totalRecurring: number | string;
  topDefaulters: Array<{
    clientId: string;
    name: string;
    category: string | null;
    contact: string;
    overdueAmount: number | string;
  }>;
}

// ---- Shapes the UI works with ----
export interface Receivable {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  status: 'paid' | 'pending' | 'overdue';
  // Only set for receivables generated from a subscription's "Gerar Fatura do Mês" —
  // lets the UI know a given month is already covered without waiting for a 409.
  subscriptionId?: string | null;
  referenceYear?: number | null;
  referenceMonth?: number | null;
}
export interface Subscription {
  id: string;
  description: string;
  amount: number;
  dueDay: number;
  status: 'active' | 'inactive';
}
export interface ClientRecord {
  id: string;
  name: string;
  category: string;
  contact: string;
  email?: string;
  status: 'active' | 'inactive';
  // Independent of status — whether this client's numbers count toward the
  // company-wide report (GET /reports/financial-summary). Only ever set via
  // deactivateClient(); not exposed on the edit form.
  includeInRevenueReport: boolean;
  // Null unless the client is in the trash (status=inactive AND
  // includeInRevenueReport=false) — only that group has a purge countdown.
  // Clients deactivated with includeInRevenueReport=true stay inactive
  // forever and this stays null-ish for UI purposes (ClientTrashDrawer never
  // shows them, since listTrashedClients() already filters server-side).
  deactivatedAt: string | null;
}
export interface ClientTotals {
  totalPaid: number;
  totalPending: number;
  totalOverdue: number;
}
export interface Defaulter {
  clientId: string;
  name: string;
  category: string | null;
  contact: string;
  overdueAmount: number;
}
export interface FinancialSummary {
  totalPaid: number;
  totalPending: number;
  totalOverdue: number;
  totalRecurring: number;
  topDefaulters: Defaulter[];
}

function mapReceivable(r: ApiReceivable): Receivable {
  return {
    id: r.id,
    description: r.description,
    amount: Number(r.amount),
    dueDate: r.dueDate.slice(0, 10),
    status: r.derivedStatus,
    subscriptionId: r.subscriptionId ?? null,
    referenceYear: r.referenceYear ?? null,
    referenceMonth: r.referenceMonth ?? null,
  };
}

function mapSubscription(s: ApiSubscription): Subscription {
  return {
    id: s.id,
    description: s.description,
    amount: Number(s.amount),
    dueDay: s.dueDay,
    status: s.status.toLowerCase() as 'active' | 'inactive',
  };
}

function mapClient(c: ApiClient): ClientRecord {
  return {
    id: c.id,
    name: c.name,
    category: c.category ?? '',
    contact: c.contact,
    email: c.email ?? undefined,
    status: c.status.toLowerCase() as 'active' | 'inactive',
    includeInRevenueReport: c.includeInRevenueReport,
    deactivatedAt: c.deactivatedAt ?? null,
  };
}

function mapClientTotals(c: ApiClient): ClientTotals {
  return {
    totalPaid: Number(c.totalPaid ?? 0),
    totalPending: Number(c.totalPending ?? 0),
    totalOverdue: Number(c.totalOverdue ?? 0),
  };
}

// ---- Clients ----
// Default ("listagem padrão") listing — só exclui quem está na lixeira
// (inativo E includeInRevenueReport=false). Um cliente inativo mantido no
// relatório continua aparecendo aqui (a UI mostra um selo "Inativo" e
// permite reativá-lo) — só some quando vai pra lixeira.
export async function listClients(): Promise<ClientRecord[]> {
  const res = await request<Paginated<ApiClient>>(`/clients?excludeTrashed=true&pageSize=100`);
  return res.items.map(mapClient);
}

export async function getClientTotals(id: string): Promise<ClientTotals> {
  const c = await request<ApiClient>(`/clients/${id}`);
  return mapClientTotals(c);
}

export async function createClient(dto: {
  name: string;
  category?: string;
  contact: string;
  email?: string;
}): Promise<ClientRecord> {
  const c = await request<ApiClient>('/clients', { method: 'POST', body: JSON.stringify(dto) });
  return mapClient(c);
}

export async function updateClient(
  id: string,
  dto: Partial<{ name: string; category: string; contact: string; email: string }>,
): Promise<ClientRecord> {
  const c = await request<ApiClient>(`/clients/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  return mapClient(c);
}

// "Excluir" in the UI — there is no hard-delete endpoint for clients by design
// (financial history must survive). This just inactivates the client.
export async function deactivateClient(id: string, includeInRevenueReport: boolean): Promise<ClientRecord> {
  const c = await request<ApiClient>(`/clients/${id}/deactivate`, {
    method: 'PATCH',
    body: JSON.stringify({ includeInRevenueReport }),
  });
  return mapClient(c);
}

// "Lixeira" — só clientes desativados com includeInRevenueReport=false
// aparecem aqui (o backend já filtra isso em GET /clients/trash).
export async function listTrashedClients(): Promise<ClientRecord[]> {
  const items = await request<ApiClient[]>(`/clients/trash`);
  return items.map(mapClient);
}

export async function restoreClient(id: string): Promise<ClientRecord> {
  const c = await request<ApiClient>(`/clients/${id}/restore`, { method: 'PATCH' });
  return mapClient(c);
}

// ---- Receivables ----
export async function listReceivables(clientId: string): Promise<Receivable[]> {
  const res = await request<Paginated<ApiReceivable>>(`/clients/${clientId}/receivables?pageSize=100`);
  return res.items.map(mapReceivable);
}

export async function createReceivable(
  clientId: string,
  dto: { description: string; amount: number; dueDate: string },
): Promise<Receivable> {
  const r = await request<ApiReceivable>(`/clients/${clientId}/receivables`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
  return mapReceivable(r);
}

export async function payReceivable(id: string): Promise<void> {
  await request(`/receivables/${id}/pay`, { method: 'PATCH' });
}

export async function unpayReceivable(id: string): Promise<void> {
  await request(`/receivables/${id}/unpay`, { method: 'PATCH' });
}

export async function deleteReceivable(id: string): Promise<void> {
  await request(`/receivables/${id}`, { method: 'DELETE' });
}

// ---- Subscriptions ----
export async function listSubscriptions(clientId: string): Promise<Subscription[]> {
  const items = await request<ApiSubscription[]>(`/clients/${clientId}/subscriptions`);
  return items.map(mapSubscription);
}

export async function createSubscription(
  clientId: string,
  dto: { description: string; amount: number; dueDay: number },
): Promise<Subscription> {
  const s = await request<ApiSubscription>(`/clients/${clientId}/subscriptions`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
  return mapSubscription(s);
}

export async function deleteSubscription(id: string): Promise<void> {
  await request(`/subscriptions/${id}`, { method: 'DELETE' });
}

export async function generateCharge(subscriptionId: string): Promise<void> {
  await request(`/subscriptions/${subscriptionId}/generate-charge`, { method: 'POST' });
}

function formatCpf(digits: string): string {
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function stripCpf(value: string): string {
  return value.replace(/\D/g, '');
}

function toPaymentDay(paymentDueDay: number, payOnLastBusinessDay: boolean): '5' | '15' | '20' | 'last' {
  if (payOnLastBusinessDay) return 'last';
  return String(paymentDueDay) as '5' | '15' | '20';
}

function fromPaymentDay(paymentDay: string): { paymentDueDay: number; payOnLastBusinessDay: boolean } {
  if (paymentDay === 'last') return { paymentDueDay: 31, payOnLastBusinessDay: true };
  return { paymentDueDay: Number(paymentDay), payOnLastBusinessDay: false };
}

// ---- Shapes returned by the backend (RH) ----
interface ApiRole {
  id: string;
  name: string;
  department: string;
  colorHex: string;
  description: string | null;
  active: boolean;
}
interface ApiEmployeeListItem {
  id: string;
  fullName: string;
  roleId: string;
  department: string;
  contractType: 'CLT' | 'PJ' | 'ESTAGIO';
  status: 'ACTIVE' | 'INACTIVE';
  cpfMasked: string;
  baseValue: number | string;
}
interface ApiEmployeeDetail {
  id: string;
  fullName: string;
  cpf: string;
  roleId: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  contractType: 'CLT' | 'PJ' | 'ESTAGIO';
  admissionDate: string;
  terminationDate: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  department: string;
  baseValue: number | string;
  paymentDueDay: number;
  payOnLastBusinessDay: boolean;
  bankDetails: string | null;
  salaryRecurrenceEnabled: boolean;
}
interface ApiWarning {
  id: string;
  occurredAt: string;
  reason: string;
}
interface ApiEmployeePayment {
  id: string;
  description: string;
  amount: number | string;
  dueDate: string;
  derivedStatus: 'pending' | 'paid' | 'overdue';
  recurringPaymentId?: string | null;
  referenceYear?: number | null;
  referenceMonth?: number | null;
}
interface ApiEmployeeRecurringPayment {
  id: string;
  description: string;
  amount: number | string;
  dueDay: number;
  status: 'ACTIVE' | 'INACTIVE';
}
interface ApiVacationSchedule {
  id: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  status: 'SCHEDULED' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}
interface ApiLeaveSchedule {
  id: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string | null;
  status: 'SCHEDULED' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

// ---- Shapes the UI works with (RH) ----
export interface Role {
  id: string;
  name: string;
  department: string;
  colorHex: string;
  description?: string;
  active: boolean;
}
export interface EmployeeListItem {
  id: string;
  fullName: string;
  roleId: string;
  department: string;
  contractType: 'clt' | 'pj' | 'estagio';
  status: 'active' | 'inactive';
  cpfMasked: string;
  baseValue: number;
}
export interface EmployeeDetail {
  id: string;
  fullName: string;
  cpf: string;
  roleId: string;
  email?: string;
  phone?: string;
  address?: string;
  contractType: 'clt' | 'pj' | 'estagio';
  admissionDate: string;
  terminationDate?: string | null;
  status: 'active' | 'inactive';
  department: string;
  baseValue: number;
  paymentDay: '5' | '15' | '20' | 'last';
  bankDetails?: string;
  salaryRecurrenceEnabled: boolean;
}
export interface EmployeeWarning {
  id: string;
  occurredAt: string;
  reason: string;
}
export interface EmployeePaymentRecord {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  status: 'pending' | 'paid' | 'overdue';
  recurringPaymentId?: string | null;
  referenceYear?: number | null;
  referenceMonth?: number | null;
}
export interface EmployeeRecurringPaymentRecord {
  id: string;
  description: string;
  amount: number;
  dueDay: number;
  status: 'active' | 'inactive';
}
export interface VacationScheduleRecord {
  id: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  status: 'scheduled' | 'approved' | 'in_progress' | 'completed' | 'cancelled';
}
export interface LeaveScheduleRecord {
  id: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string | null;
  status: 'scheduled' | 'approved' | 'in_progress' | 'completed' | 'cancelled';
}

export interface EmployeeFormInput {
  fullName: string;
  cpf: string;
  roleId: string;
  email?: string;
  phone?: string;
  address?: string;
  contractType: 'clt' | 'pj' | 'estagio';
  admissionDate: string;
  department: string;
  baseValue: number;
  paymentDay: '5' | '15' | '20' | 'last';
  bankDetails?: string;
  salaryRecurrenceEnabled?: boolean;
}

function mapRole(r: ApiRole): Role {
  return {
    id: r.id,
    name: r.name,
    department: r.department,
    colorHex: r.colorHex,
    description: r.description ?? undefined,
    active: r.active,
  };
}

function mapEmployeeListItem(e: ApiEmployeeListItem): EmployeeListItem {
  return {
    id: e.id,
    fullName: e.fullName,
    roleId: e.roleId,
    department: e.department,
    contractType: e.contractType.toLowerCase() as EmployeeListItem['contractType'],
    status: e.status.toLowerCase() as EmployeeListItem['status'],
    cpfMasked: e.cpfMasked,
    baseValue: Number(e.baseValue),
  };
}

function mapEmployeeDetail(e: ApiEmployeeDetail): EmployeeDetail {
  return {
    id: e.id,
    fullName: e.fullName,
    cpf: formatCpf(e.cpf),
    roleId: e.roleId,
    email: e.email ?? undefined,
    phone: e.phone ?? undefined,
    address: e.address ?? undefined,
    contractType: e.contractType.toLowerCase() as EmployeeDetail['contractType'],
    admissionDate: e.admissionDate.slice(0, 10),
    terminationDate: e.terminationDate ? e.terminationDate.slice(0, 10) : null,
    status: e.status.toLowerCase() as EmployeeDetail['status'],
    department: e.department,
    baseValue: Number(e.baseValue),
    paymentDay: toPaymentDay(e.paymentDueDay, e.payOnLastBusinessDay),
    bankDetails: e.bankDetails ?? undefined,
    salaryRecurrenceEnabled: e.salaryRecurrenceEnabled,
  };
}

function toEmployeeDto(input: EmployeeFormInput) {
  const { paymentDueDay, payOnLastBusinessDay } = fromPaymentDay(input.paymentDay);
  return {
    fullName: input.fullName,
    cpf: stripCpf(input.cpf),
    roleId: input.roleId,
    email: input.email || undefined,
    phone: input.phone || undefined,
    address: input.address || undefined,
    contractType: input.contractType.toUpperCase(),
    admissionDate: input.admissionDate,
    department: input.department,
    baseValue: input.baseValue,
    paymentDueDay,
    payOnLastBusinessDay,
    bankDetails: input.bankDetails || undefined,
    salaryRecurrenceEnabled: input.salaryRecurrenceEnabled,
  };
}

function mapWarning(w: ApiWarning): EmployeeWarning {
  return {
    id: w.id,
    occurredAt: w.occurredAt.slice(0, 10),
    reason: w.reason,
  };
}

function mapEmployeePayment(p: ApiEmployeePayment): EmployeePaymentRecord {
  return {
    id: p.id,
    description: p.description,
    amount: Number(p.amount),
    dueDate: p.dueDate.slice(0, 10),
    status: p.derivedStatus,
    recurringPaymentId: p.recurringPaymentId ?? null,
    referenceYear: p.referenceYear ?? null,
    referenceMonth: p.referenceMonth ?? null,
  };
}

function mapEmployeeRecurringPayment(r: ApiEmployeeRecurringPayment): EmployeeRecurringPaymentRecord {
  return {
    id: r.id,
    description: r.description,
    amount: Number(r.amount),
    dueDay: r.dueDay,
    status: r.status.toLowerCase() as EmployeeRecurringPaymentRecord['status'],
  };
}

function mapVacationSchedule(s: ApiVacationSchedule): VacationScheduleRecord {
  return {
    id: s.id,
    startDate: s.startDate.slice(0, 10),
    endDate: s.endDate.slice(0, 10),
    daysCount: s.daysCount,
    status: s.status.toLowerCase() as VacationScheduleRecord['status'],
  };
}

function mapLeaveSchedule(s: ApiLeaveSchedule): LeaveScheduleRecord {
  return {
    id: s.id,
    startDate: s.startDate.slice(0, 10),
    endDate: s.endDate.slice(0, 10),
    daysCount: s.daysCount,
    reason: s.reason ?? null,
    status: s.status.toLowerCase() as LeaveScheduleRecord['status'],
  };
}

// ---- Roles (Cargos) ----
export async function listRoles(): Promise<Role[]> {
  const res = await request<Paginated<ApiRole>>(`/roles?pageSize=100`);
  return res.items.map(mapRole);
}

export async function listActiveRoles(): Promise<Role[]> {
  const items = await request<ApiRole[]>(`/roles/active`);
  return items.map(mapRole);
}

export async function createRole(dto: {
  name: string; department: string; colorHex?: string; description?: string;
}): Promise<Role> {
  const r = await request<ApiRole>('/roles', { method: 'POST', body: JSON.stringify(dto) });
  return mapRole(r);
}

export async function updateRole(
  id: string,
  dto: Partial<{ name: string; department: string; colorHex: string; description: string }>,
): Promise<Role> {
  const r = await request<ApiRole>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  return mapRole(r);
}

export async function deactivateRole(id: string): Promise<Role> {
  const r = await request<ApiRole>(`/roles/${id}/deactivate`, { method: 'PATCH' });
  return mapRole(r);
}

export async function reactivateRole(id: string): Promise<Role> {
  const r = await request<ApiRole>(`/roles/${id}/reactivate`, { method: 'PATCH' });
  return mapRole(r);
}

// ---- Employees (Funcionários) ----
export async function listEmployees(): Promise<EmployeeListItem[]> {
  const res = await request<Paginated<ApiEmployeeListItem>>(`/employees?pageSize=100`);
  return res.items.map(mapEmployeeListItem);
}

export async function getEmployee(id: string): Promise<EmployeeDetail> {
  const e = await request<ApiEmployeeDetail>(`/employees/${id}`);
  return mapEmployeeDetail(e);
}

export async function createEmployee(input: EmployeeFormInput): Promise<EmployeeDetail> {
  const e = await request<ApiEmployeeDetail>('/employees', { method: 'POST', body: JSON.stringify(toEmployeeDto(input)) });
  return mapEmployeeDetail(e);
}

export async function updateEmployee(id: string, input: Partial<EmployeeFormInput>): Promise<EmployeeDetail> {
  const dto: Record<string, unknown> = { ...input };
  if (input.cpf !== undefined) dto.cpf = stripCpf(input.cpf);
  // email/phone/address/bankDetails são colunas genuinamente nullable (String? no schema
  // Prisma) — ao limpar o campo, enviamos `null` explícito (em vez de `undefined`, que o
  // JSON.stringify omite do body, fazendo o backend nunca ver a atualização e manter o
  // valor antigo silenciosamente). O backend aceita `null` via @IsOptional() e persiste
  // como NULL de verdade.
  if (input.email !== undefined) dto.email = input.email || null;
  if (input.phone !== undefined) dto.phone = input.phone || null;
  if (input.address !== undefined) dto.address = input.address || null;
  if (input.bankDetails !== undefined) dto.bankDetails = input.bankDetails || null;
  // department/admissionDate NÃO são nullable (String / DateTime @db.Date sem `?`) — aqui
  // `|| undefined` existe só pra nunca mandar uma string vazia inválida, não pra "limpar"
  // nada, então continuam como estavam.
  if (input.department !== undefined) dto.department = input.department || undefined;
  if (input.admissionDate !== undefined) dto.admissionDate = input.admissionDate || undefined;
  if (input.contractType !== undefined) dto.contractType = input.contractType.toUpperCase();
  if (input.paymentDay !== undefined) {
    const { paymentDueDay, payOnLastBusinessDay } = fromPaymentDay(input.paymentDay);
    dto.paymentDueDay = paymentDueDay;
    dto.payOnLastBusinessDay = payOnLastBusinessDay;
    delete dto.paymentDay;
  }
  const e = await request<ApiEmployeeDetail>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  return mapEmployeeDetail(e);
}

export async function deactivateEmployee(id: string): Promise<EmployeeDetail> {
  const e = await request<ApiEmployeeDetail>(`/employees/${id}/deactivate`, { method: 'PATCH' });
  return mapEmployeeDetail(e);
}

export async function reactivateEmployee(id: string): Promise<EmployeeDetail> {
  const e = await request<ApiEmployeeDetail>(`/employees/${id}/reactivate`, { method: 'PATCH' });
  return mapEmployeeDetail(e);
}

// ---- Employee Warnings (Advertências) ----
export async function listWarnings(employeeId: string): Promise<EmployeeWarning[]> {
  const items = await request<ApiWarning[]>(`/employees/${employeeId}/warnings`);
  return items.map(mapWarning);
}

export async function createWarning(
  employeeId: string,
  dto: { occurredAt: string; reason: string },
): Promise<EmployeeWarning> {
  const w = await request<ApiWarning>(`/employees/${employeeId}/warnings`, { method: 'POST', body: JSON.stringify(dto) });
  return mapWarning(w);
}

// ---- Employee Payments (Pagamentos avulsos) ----
export async function listEmployeePayments(employeeId: string): Promise<EmployeePaymentRecord[]> {
  const res = await request<Paginated<ApiEmployeePayment>>(`/employees/${employeeId}/payments?pageSize=100`);
  return res.items.map(mapEmployeePayment);
}

export async function payEmployeePayment(id: string): Promise<void> {
  await request(`/employee-payments/${id}/pay`, { method: 'PATCH' });
}

// ---- Employee Recurring Payments (Recorrência) ----
export async function listEmployeeRecurringPayments(employeeId: string): Promise<EmployeeRecurringPaymentRecord[]> {
  const items = await request<ApiEmployeeRecurringPayment[]>(`/employees/${employeeId}/recurring-payments`);
  return items.map(mapEmployeeRecurringPayment);
}

export async function createEmployeeRecurringPayment(
  employeeId: string,
  dto: { description: string; amount: number; dueDay: number },
): Promise<EmployeeRecurringPaymentRecord> {
  const r = await request<ApiEmployeeRecurringPayment>(
    `/employees/${employeeId}/recurring-payments`,
    { method: 'POST', body: JSON.stringify(dto) },
  );
  return mapEmployeeRecurringPayment(r);
}

export async function deactivateEmployeeRecurringPayment(id: string): Promise<void> {
  await request(`/employee-recurring-payments/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'INACTIVE' }) });
}

export async function generateEmployeeCharge(recurringPaymentId: string): Promise<void> {
  await request(`/employee-recurring-payments/${recurringPaymentId}/generate-charge`, { method: 'POST' });
}

// ---- Vacations (Férias) ----
export async function scheduleVacation(
  employeeId: string,
  dto: { startDate: string; endDate: string; daysCount: number; exceptionAuthorized?: boolean },
): Promise<VacationScheduleRecord> {
  const s = await request<ApiVacationSchedule>(`/employees/${employeeId}/vacation/schedule`, { method: 'POST', body: JSON.stringify(dto) });
  return mapVacationSchedule(s);
}

export async function listVacationSchedules(employeeId: string): Promise<VacationScheduleRecord[]> {
  const items = await request<ApiVacationSchedule[]>(`/employees/${employeeId}/vacation/schedules`);
  return items.map(mapVacationSchedule);
}

// ---- Afastamento (Leave) ----
export async function scheduleLeave(
  employeeId: string,
  dto: { startDate: string; endDate: string; daysCount: number; reason?: string; notes?: string },
): Promise<LeaveScheduleRecord> {
  const s = await request<ApiLeaveSchedule>(`/employees/${employeeId}/leave/schedule`, { method: 'POST', body: JSON.stringify(dto) });
  return mapLeaveSchedule(s);
}

export async function listLeaveSchedules(employeeId: string): Promise<LeaveScheduleRecord[]> {
  const items = await request<ApiLeaveSchedule[]>(`/employees/${employeeId}/leave/schedules`);
  return items.map(mapLeaveSchedule);
}

// ---- Reports ----
export async function getFinancialSummary(): Promise<FinancialSummary> {
  const res = await request<ApiFinancialSummary>(`/reports/financial-summary`);
  return {
    totalPaid: Number(res.totalPaid),
    totalPending: Number(res.totalPending),
    totalOverdue: Number(res.totalOverdue),
    totalRecurring: Number(res.totalRecurring),
    topDefaulters: res.topDefaulters.map((d) => ({ ...d, overdueAmount: Number(d.overdueAmount) })),
  };
}
