import { getAccessToken, refreshOnce } from './auth';
import { ApiError } from './apiError';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const token = getAccessToken();
  // Upload multipart (batida de ponto com foto, anexo de ajuste/justificativa) manda FormData no
  // body — nesse caso o Content-Type (com o boundary) precisa ser definido pelo próprio browser,
  // nunca fixado aqui como application/json (ver createTimePunch/createAdjustmentRequest/
  // createJustification abaixo).
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include', // manda o cookie httpOnly do refresh token em toda chamada
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // 401 pode ser access token expirado — tenta renovar silenciosamente uma
  // única vez (isRetry evita loop infinito se o refresh também falhar) antes
  // de desistir e propagar o erro.
  if (res.status === 401 && !isRetry) {
    const renewed = await refreshOnce();
    if (renewed) return request<T>(path, options, true);
  }

  if (!res.ok) {
    // Erro de servidor (5xx) nunca é um aviso pensado pra pessoa entender — é sempre algo
    // inesperado (um bug, uma indisponibilidade). Mostrar a mensagem técnica crua que vem do
    // servidor ("Internal server error" e afins) nunca ajuda o usuário final a saber o que fazer;
    // toda mensagem específica e amigável (campo obrigatório, valor inválido, etc.) já vem como
    // um 4xx, tratado no ramo abaixo.
    if (res.status >= 500) {
      throw new Error('Não foi possível concluir a ação. Tente novamente em instantes.');
    }
    const body = await res.json().catch(() => ({}) as { message?: string | string[]; code?: string });
    // O backend hoje sempre devolve `message` como uma string única já traduzida — isto é uma
    // segunda camada de segurança, não a correção principal, pra nunca mostrar vírgulas cruas se
    // algo no futuro voltar a devolver uma lista.
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    // ApiError carrega status + code (ex.: ACCOUNT_TEMPORARILY_LOCKED) — quem chama pode reagir a um
    // código específico sem depender do texto da mensagem; `err.message` continua funcionando igual.
    throw new ApiError(message || `Erro ${res.status} ao chamar ${path}`, res.status, body.code, body as Record<string, unknown>);
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
  customFields?: Record<string, unknown>;
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
  customFields?: Record<string, unknown>;
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
    customFields: c.customFields ?? {},
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
  customFields?: Record<string, unknown>;
}): Promise<ClientRecord> {
  const c = await request<ApiClient>('/clients', { method: 'POST', body: JSON.stringify(dto) });
  return mapClient(c);
}

export async function updateClient(
  id: string,
  dto: Partial<{ name: string; category: string; contact: string; email: string | null; customFields: Record<string, unknown> }>,
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
  customFields?: Record<string, unknown>;
}
interface ApiEmployeeListItem {
  id: string;
  fullName: string;
  roleId: string;
  managerId: string | null;
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
  managerId: string | null;
  managerName: string | null;
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
  customFields?: Record<string, unknown>;
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
  customFields?: Record<string, unknown>;
}
export interface EmployeeListItem {
  id: string;
  fullName: string;
  roleId: string;
  managerId: string | null;
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
  managerId: string | null;
  managerName: string | null;
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
  customFields?: Record<string, unknown>;
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
  managerId?: string | null;
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
  customFields?: Record<string, unknown>;
}

function mapRole(r: ApiRole): Role {
  return {
    id: r.id,
    name: r.name,
    department: r.department,
    colorHex: r.colorHex,
    description: r.description ?? undefined,
    active: r.active,
    customFields: r.customFields ?? {},
  };
}

function mapEmployeeListItem(e: ApiEmployeeListItem): EmployeeListItem {
  return {
    id: e.id,
    fullName: e.fullName,
    roleId: e.roleId,
    managerId: e.managerId,
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
    managerId: e.managerId,
    managerName: e.managerName,
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
    customFields: e.customFields ?? {},
  };
}

function toEmployeeDto(input: EmployeeFormInput) {
  const { paymentDueDay, payOnLastBusinessDay } = fromPaymentDay(input.paymentDay);
  return {
    fullName: input.fullName,
    cpf: stripCpf(input.cpf),
    roleId: input.roleId,
    managerId: input.managerId || undefined,
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
    customFields: input.customFields,
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
  customFields?: Record<string, unknown>;
}): Promise<Role> {
  const r = await request<ApiRole>('/roles', { method: 'POST', body: JSON.stringify(dto) });
  return mapRole(r);
}

export async function updateRole(
  id: string,
  dto: Partial<{ name: string; department: string; colorHex: string; description: string; customFields: Record<string, unknown> }>,
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
  if (input.managerId !== undefined) dto.managerId = input.managerId || null;
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

export async function unpayEmployeePayment(id: string): Promise<void> {
  await request(`/employee-payments/${id}/unpay`, { method: 'PATCH' });
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

export async function deleteEmployeeRecurringPayment(id: string): Promise<void> {
  await request(`/employee-recurring-payments/${id}`, { method: 'DELETE' });
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

export async function cancelVacationSchedule(id: string): Promise<void> {
  await request(`/vacation-schedules/${id}/cancel`, { method: 'PATCH' });
}

export async function resumeVacationSchedule(id: string, exceptionAuthorized?: boolean): Promise<void> {
  await request(`/vacation-schedules/${id}/resume`, { method: 'PATCH', body: JSON.stringify({ exceptionAuthorized }) });
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

export async function cancelLeaveSchedule(id: string): Promise<void> {
  await request(`/leave-schedules/${id}/cancel`, { method: 'PATCH' });
}

export async function resumeLeaveSchedule(id: string): Promise<void> {
  await request(`/leave-schedules/${id}/resume`, { method: 'PATCH' });
}

// ---- System Users (Usuários e Acessos) ----
interface ApiSystemUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'EMPLOYEE';
  employeeId: string | null;
  modules: string[];
  status: 'ACTIVE' | 'BLOCKED' | 'LOCKED';
  hasFullPontoAccess: boolean;
  profileId: string | null;
}

export interface SystemUser {
  id: string;
  email: string;
  role: 'admin' | 'employee';
  employeeId: string | null;
  modules: string[];
  status: 'active' | 'blocked' | 'locked';
  hasFullPontoAccess: boolean;
  profileId: string | null;
}

function mapSystemUser(u: ApiSystemUser): SystemUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role.toLowerCase() as SystemUser['role'],
    employeeId: u.employeeId ?? null,
    modules: u.modules,
    status: u.status.toLowerCase() as SystemUser['status'],
    hasFullPontoAccess: u.hasFullPontoAccess,
    profileId: u.profileId,
  };
}

export async function listSystemUsers(): Promise<SystemUser[]> {
  const items = await request<ApiSystemUser[]>(`/companies/me/users`);
  return items.map(mapSystemUser);
}

export async function createSystemUser(dto: {
  email: string;
  role: 'admin' | 'employee';
  employeeId?: string;
  profileId: string;
}): Promise<{ user: SystemUser; temporaryPassword: string }> {
  const res = await request<{ user: ApiSystemUser; temporaryPassword: string }>('/companies/me/users', {
    method: 'POST',
    body: JSON.stringify({
      email: dto.email,
      role: dto.role.toUpperCase(),
      employeeId: dto.role === 'employee' ? dto.employeeId : undefined,
      profileId: dto.profileId,
    }),
  });
  return { user: mapSystemUser(res.user), temporaryPassword: res.temporaryPassword };
}

// Substitui updateSystemUser()/updatePontoAccess() (Fase 2a, 19/09/2026) — Módulos e acesso de
// Ponto deixam de ser editados diretamente, passam a ser SEMPRE derivados do Perfil escolhido.
export async function assignUserProfile(userId: string, profileId: string): Promise<void> {
  await request(`/companies/me/users/${userId}/profile`, {
    method: 'PATCH',
    body: JSON.stringify({ profileId }),
  });
}

// Exclusão de verdade (17/09/2026) — diferente de bloquear, que é reversível. O backend recusa
// excluir o último ADMIN ativo da empresa.
export async function deleteSystemUser(id: string): Promise<void> {
  await request(`/companies/me/users/${id}`, { method: 'DELETE' });
}

// Redefinição de senha por um admin (17/09/2026) — gera uma senha temporária nova (mesmo padrão
// da criação, devolvida uma única vez), reativa o login e zera o contador de tentativas erradas —
// é o caminho de saída de um login LOCKED por excesso de tentativas.
export async function resetSystemUserPassword(id: string): Promise<{ temporaryPassword: string }> {
  return request<{ temporaryPassword: string }>(`/companies/me/users/${id}/reset-password`, { method: 'PATCH' });
}

export async function blockSystemUser(id: string): Promise<void> {
  await request(`/companies/me/users/${id}/block`, { method: 'PATCH' });
}

export async function unblockSystemUser(id: string): Promise<void> {
  await request(`/companies/me/users/${id}/unblock`, { method: 'PATCH' });
}

// ---- Perfis de Acesso (Fase 2a, 19/09/2026) ----
export interface PermissionCatalogEntry {
  code: string;
  resource: string;
  action: string;
  labelPt: string;
  validScopes: ('PROPRIO' | 'EQUIPE' | 'DEPARTAMENTO' | 'EMPRESA')[];
}

export async function getPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
  return request<PermissionCatalogEntry[]>('/profiles/catalog');
}

export interface ProfileGrant {
  permissionCode: string;
  scope: 'PROPRIO' | 'EQUIPE' | 'DEPARTAMENTO' | 'EMPRESA' | null;
}

interface ApiProfile {
  id: string;
  name: string;
  isProtected: boolean;
  userCount: number;
  grants: ProfileGrant[];
}

export interface Profile {
  id: string;
  name: string;
  isProtected: boolean;
  userCount: number;
  grants: ProfileGrant[];
}

function mapProfile(p: ApiProfile): Profile {
  return { id: p.id, name: p.name, isProtected: p.isProtected, userCount: p.userCount, grants: p.grants };
}

export async function listProfiles(): Promise<Profile[]> {
  const items = await request<ApiProfile[]>('/profiles');
  return items.map(mapProfile);
}

export async function createProfile(dto: { name: string; grants: ProfileGrant[] }): Promise<Profile> {
  const res = await request<ApiProfile>('/profiles', { method: 'POST', body: JSON.stringify(dto) });
  return mapProfile(res);
}

export async function updateProfile(id: string, dto: { name: string; grants: ProfileGrant[] }): Promise<Profile> {
  const res = await request<ApiProfile>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
  return mapProfile(res);
}

export async function deleteProfile(id: string): Promise<void> {
  await request(`/profiles/${id}`, { method: 'DELETE' });
}

export async function reassignAndDeleteProfile(id: string, targetProfileId: string): Promise<void> {
  await request(`/profiles/${id}/reassign-and-delete`, {
    method: 'POST',
    body: JSON.stringify({ targetProfileId }),
  });
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

// ==== Controle de Ponto (Time Tracking) ====

// ---- Shapes returned by the backend ----
interface ApiTimeEvent {
  id: string;
  employeeId: string;
  type: 'CLOCK_IN' | 'BREAK_START' | 'BREAK_END' | 'CLOCK_OUT' | 'EXTRA_IN' | 'EXTRA_OUT';
  source: 'WEB' | 'MOBILE' | 'ADMIN_MANUAL';
  serverRecordedAt: string;
  latitude: string | number | null;
  longitude: string | number | null;
  locationStatus: 'WITHIN_RANGE' | 'OUT_OF_RANGE' | 'IMPRECISE' | 'UNAVAILABLE' | 'NOT_REQUIRED';
  validationStatus: 'VALID' | 'PENDING_REVIEW' | 'CORRECTED';
  downloadUrl: string | null;
}
interface ApiTimeClockStatus {
  nextAllowedType: ApiTimeEvent['type'];
  requirePhoto: boolean;
  requireLocation: boolean;
}
interface ApiDailySummary {
  date: string;
  workedMinutes: number;
  expectedMinutes: number;
  breakMinutes: number;
  extraMinutes: number;
  balanceMinutes: number;
  isHoliday: boolean;
  isOnVacationOrLeave: boolean;
  hasOpenJourney: boolean;
  events: ApiTimeEvent[];
}
interface ApiMonthlySummary {
  days: ApiDailySummary[];
  totals: { workedMinutes: number; expectedMinutes: number; extraMinutes: number; balanceMinutes: number };
}
interface ApiTimeAdjustmentRequest {
  id: string;
  employeeId: string;
  targetDate: string;
  relatedEventId: string | null;
  type: 'ADD_MISSING_PUNCH' | 'CORRECT_TIME' | 'REMOVE_PUNCH';
  requestedEventType: ApiTimeEvent['type'] | null;
  requestedTime: string | null;
  reason: string;
  justification: string | null;
  downloadUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
interface ApiTimeJustification {
  id: string;
  employeeId: string;
  relatedDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  type: 'ABSENCE' | 'INCOMPLETE_DAY' | 'ADJUSTMENT_SUPPORT' | 'MEDICAL_CERTIFICATE' | 'OTHER';
  description: string;
  downloadUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
interface ApiWorkSchedule {
  id: string;
  employeeId: string | null;
  managerId: string | null;
  name: string;
  weekDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  breakMinutes: number;
  dailyMinutes: number;
  weeklyMinutes: number;
  toleranceMinutes: number;
  allowOvertime: boolean;
  maxOvertimeMinutesPerDay: number | null;
  nightShift: boolean;
  validFrom: string;
  validTo: string | null;
}
interface ApiWorkLocation {
  id: string;
  name: string;
  latitude: string | number;
  longitude: string | number;
  radiusMeters: number;
  active: boolean;
}
interface ApiTimeTrackingSettings {
  requirePhoto: boolean;
  requireLocation: boolean;
  allowLocationException: boolean;
  allowExtraPeriods: boolean;
  maxAttachmentSizeBytes: number;
  managerId: string | null;
  // true quando a leitura de um escopo de time caiu no padrão da EMPRESA por ainda não existir
  // sobrescrita própria daquele superior — a leitura nunca cria a sobrescrita (ver
  // TimeTrackingSettingsService.getScoped no backend). Só aparece no GET; nunca é reenviado no
  // PATCH (ver updateTimeTrackingSettings).
  inherited?: boolean;
}

// ---- Shapes the UI works with ----
export type TimePunchType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out' | 'extra_in' | 'extra_out';

export interface TimeClockStatus {
  nextAllowedType: TimePunchType;
  requirePhoto: boolean;
  requireLocation: boolean;
}
export interface TimePunch {
  id: string;
  employeeId: string;
  type: TimePunchType;
  source: 'web' | 'mobile' | 'admin_manual';
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
  locationStatus: 'within_range' | 'out_of_range' | 'imprecise' | 'unavailable' | 'not_required';
  validationStatus: 'valid' | 'pending_review' | 'corrected';
  photoDownloadUrl: string | null;
}
export interface DailySummary {
  date: string;
  workedMinutes: number;
  expectedMinutes: number;
  breakMinutes: number;
  extraMinutes: number;
  balanceMinutes: number;
  isHoliday: boolean;
  isOnVacationOrLeave: boolean;
  hasOpenJourney: boolean;
  events: TimePunch[];
}
export interface MonthlySummary {
  days: DailySummary[];
  totals: { workedMinutes: number; expectedMinutes: number; extraMinutes: number; balanceMinutes: number };
}
export interface AdjustmentRequestRecord {
  id: string;
  employeeId: string;
  targetDate: string;
  relatedEventId: string | null;
  type: 'add_missing_punch' | 'correct_time' | 'remove_punch';
  requestedEventType: TimePunchType | null;
  requestedTime: string | null;
  reason: string;
  justification: string | null;
  downloadUrl: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
export interface JustificationRecord {
  id: string;
  employeeId: string;
  relatedDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  type: 'absence' | 'incomplete_day' | 'adjustment_support' | 'medical_certificate' | 'other';
  description: string;
  downloadUrl: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
export interface WorkScheduleRecord {
  id: string;
  employeeId: string | null;
  managerId: string | null;
  name: string;
  weekDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  breakMinutes: number;
  dailyMinutes: number;
  weeklyMinutes: number;
  toleranceMinutes: number;
  allowOvertime: boolean;
  maxOvertimeMinutesPerDay: number | null;
  nightShift: boolean;
  validFrom: string;
  validTo: string | null;
}
export interface WorkLocationRecord {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  active: boolean;
}
export interface TimeTrackingSettingsRecord {
  requirePhoto: boolean;
  requireLocation: boolean;
  allowLocationException: boolean;
  allowExtraPeriods: boolean;
  maxAttachmentSizeBytes: number;
  managerId: string | null;
  // Ver ApiTimeTrackingSettings.inherited — usado só pra exibir "herdado do padrão da empresa" na
  // aba de Configuração; nunca vai de volta no PATCH.
  inherited: boolean;
}

function mapTimePunch(e: ApiTimeEvent): TimePunch {
  return {
    id: e.id,
    employeeId: e.employeeId,
    type: e.type.toLowerCase() as TimePunchType,
    source: e.source.toLowerCase() as TimePunch['source'],
    recordedAt: e.serverRecordedAt,
    latitude: e.latitude != null ? Number(e.latitude) : null,
    longitude: e.longitude != null ? Number(e.longitude) : null,
    locationStatus: e.locationStatus.toLowerCase() as TimePunch['locationStatus'],
    validationStatus: e.validationStatus.toLowerCase() as TimePunch['validationStatus'],
    photoDownloadUrl: e.downloadUrl,
  };
}
function mapDailySummary(d: ApiDailySummary): DailySummary {
  return { ...d, events: d.events.map(mapTimePunch) };
}
function mapMonthlySummary(m: ApiMonthlySummary): MonthlySummary {
  return { days: m.days.map(mapDailySummary), totals: m.totals };
}
function mapAdjustmentRequest(r: ApiTimeAdjustmentRequest): AdjustmentRequestRecord {
  return {
    id: r.id,
    employeeId: r.employeeId,
    targetDate: r.targetDate.slice(0, 10),
    relatedEventId: r.relatedEventId,
    type: r.type.toLowerCase() as AdjustmentRequestRecord['type'],
    requestedEventType: r.requestedEventType ? (r.requestedEventType.toLowerCase() as TimePunchType) : null,
    requestedTime: r.requestedTime,
    reason: r.reason,
    justification: r.justification,
    downloadUrl: r.downloadUrl,
    status: r.status.toLowerCase() as AdjustmentRequestRecord['status'],
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt,
    createdAt: r.createdAt,
  };
}
function mapJustification(j: ApiTimeJustification): JustificationRecord {
  return {
    id: j.id,
    employeeId: j.employeeId,
    relatedDate: j.relatedDate ? j.relatedDate.slice(0, 10) : null,
    periodStart: j.periodStart ? j.periodStart.slice(0, 10) : null,
    periodEnd: j.periodEnd ? j.periodEnd.slice(0, 10) : null,
    type: j.type.toLowerCase() as JustificationRecord['type'],
    description: j.description,
    downloadUrl: j.downloadUrl,
    status: j.status.toLowerCase() as JustificationRecord['status'],
    reviewNote: j.reviewNote,
    reviewedAt: j.reviewedAt,
    createdAt: j.createdAt,
  };
}
function mapWorkSchedule(s: ApiWorkSchedule): WorkScheduleRecord {
  return {
    id: s.id,
    employeeId: s.employeeId,
    managerId: s.managerId,
    name: s.name,
    weekDays: s.weekDays,
    expectedStartTime: s.expectedStartTime,
    expectedEndTime: s.expectedEndTime,
    breakMinutes: s.breakMinutes,
    dailyMinutes: s.dailyMinutes,
    weeklyMinutes: s.weeklyMinutes,
    toleranceMinutes: s.toleranceMinutes,
    allowOvertime: s.allowOvertime,
    maxOvertimeMinutesPerDay: s.maxOvertimeMinutesPerDay,
    nightShift: s.nightShift,
    validFrom: s.validFrom.slice(0, 10),
    validTo: s.validTo ? s.validTo.slice(0, 10) : null,
  };
}
function mapWorkLocation(l: ApiWorkLocation): WorkLocationRecord {
  return {
    id: l.id,
    name: l.name,
    latitude: Number(l.latitude),
    longitude: Number(l.longitude),
    radiusMeters: l.radiusMeters,
    active: l.active,
  };
}
function mapTimeTrackingSettings(s: ApiTimeTrackingSettings): TimeTrackingSettingsRecord {
  return {
    requirePhoto: s.requirePhoto,
    requireLocation: s.requireLocation,
    allowLocationException: s.allowLocationException,
    allowExtraPeriods: s.allowExtraPeriods,
    maxAttachmentSizeBytes: s.maxAttachmentSizeBytes,
    managerId: s.managerId,
    inherited: s.inherited ?? false,
  };
}

// FormData só recebe string/Blob — descarta campos undefined/null em vez de mandar "undefined"
// como string. Usado pelos 3 endpoints multipart (foto de ponto, anexo de ajuste, anexo de
// justificativa) — nunca JSON.stringify nesses três, o browser define o Content-Type/boundary
// sozinho (ver request() no topo do arquivo).
function toFormData(fields: Record<string, string | number | boolean | undefined | null>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) fd.append(key, String(value));
  }
  return fd;
}

// ---- Bater o próprio ponto ----
export async function getTimeClockStatus(): Promise<TimeClockStatus> {
  const s = await request<ApiTimeClockStatus>('/time-clock/status');
  return { nextAllowedType: s.nextAllowedType.toLowerCase() as TimePunchType, requirePhoto: s.requirePhoto, requireLocation: s.requireLocation };
}

export async function createTimePunch(input: {
  type: TimePunchType;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  deviceReportedAt?: string;
  isMobile?: boolean;
  photo?: File;
}): Promise<{ event: TimePunch; nextAllowedType: TimePunchType }> {
  const fd = toFormData({
    type: input.type.toUpperCase(),
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
    deviceReportedAt: input.deviceReportedAt,
    isMobile: input.isMobile,
  });
  if (input.photo) fd.append('photo', input.photo);
  const res = await request<{ event: ApiTimeEvent; nextAllowedType: ApiTimeEvent['type'] }>('/time-clock/punches', {
    method: 'POST',
    body: fd,
  });
  return { event: mapTimePunch(res.event), nextAllowedType: res.nextAllowedType.toLowerCase() as TimePunchType };
}

export async function listOwnTimePunches(from?: string, to?: string): Promise<TimePunch[]> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const query = qs.toString();
  const events = await request<ApiTimeEvent[]>(`/time-clock/punches${query ? `?${query}` : ''}`);
  return events.map(mapTimePunch);
}

export async function getOwnTimeSummary(year: number, month: number): Promise<MonthlySummary> {
  const res = await request<ApiMonthlySummary>(`/time-clock/summary?year=${year}&month=${month}`);
  return mapMonthlySummary(res);
}

// ---- Solicitações de ajuste (funcionário) ----
export async function createAdjustmentRequest(input: {
  targetDate: string;
  relatedEventId?: string;
  type: 'add_missing_punch' | 'correct_time' | 'remove_punch';
  requestedEventType?: TimePunchType;
  requestedTime?: string;
  reason: string;
  justification?: string;
  attachment?: File;
}): Promise<AdjustmentRequestRecord> {
  const fd = toFormData({
    targetDate: input.targetDate,
    relatedEventId: input.relatedEventId,
    type: input.type.toUpperCase(),
    requestedEventType: input.requestedEventType?.toUpperCase(),
    requestedTime: input.requestedTime,
    reason: input.reason,
    justification: input.justification,
  });
  if (input.attachment) fd.append('attachment', input.attachment);
  const r = await request<ApiTimeAdjustmentRequest>('/time-adjustment-requests', { method: 'POST', body: fd });
  return mapAdjustmentRequest(r);
}

export async function listOwnAdjustmentRequests(): Promise<AdjustmentRequestRecord[]> {
  const items = await request<ApiTimeAdjustmentRequest[]>('/time-adjustment-requests/me');
  return items.map(mapAdjustmentRequest);
}

export async function cancelAdjustmentRequest(id: string): Promise<AdjustmentRequestRecord> {
  const r = await request<ApiTimeAdjustmentRequest>(`/time-adjustment-requests/${id}/cancel`, { method: 'PATCH' });
  return mapAdjustmentRequest(r);
}

// ---- Justificativas e atestados (funcionário) ----
export async function createJustification(input: {
  type: 'absence' | 'incomplete_day' | 'adjustment_support' | 'medical_certificate' | 'other';
  description: string;
  relatedDate?: string;
  periodStart?: string;
  periodEnd?: string;
  attachment?: File;
}): Promise<JustificationRecord> {
  const fd = toFormData({
    type: input.type.toUpperCase(),
    description: input.description,
    relatedDate: input.relatedDate,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });
  if (input.attachment) fd.append('attachment', input.attachment);
  const j = await request<ApiTimeJustification>('/time-justifications', { method: 'POST', body: fd });
  return mapJustification(j);
}

export async function listOwnJustifications(): Promise<JustificationRecord[]> {
  const items = await request<ApiTimeJustification[]>('/time-justifications/me');
  return items.map(mapJustification);
}

// ---- Visões administrativas (ADMIN ou superior direto) ----
export async function listCompanyTimeEvents(
  employeeId: string,
  params?: { from?: string; to?: string; status?: 'valid' | 'pending_review' | 'corrected'; page?: number; pageSize?: number },
): Promise<Paginated<TimePunch>> {
  const qs = new URLSearchParams();
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.status) qs.set('status', params.status.toUpperCase());
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const query = qs.toString();
  const res = await request<Paginated<ApiTimeEvent>>(`/employees/${employeeId}/time-events${query ? `?${query}` : ''}`);
  return { ...res, items: res.items.map(mapTimePunch) };
}

// Sem filtro de status forçado apesar do nome — "Pending" reflete o uso típico (a caixa de
// entrada de aprovações), mas o caller pode pedir outro status explicitamente; simétrico a
// listJustificationsForReview logo abaixo.
export async function listPendingAdjustmentRequests(params?: {
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled';
  page?: number;
  pageSize?: number;
}): Promise<Paginated<AdjustmentRequestRecord>> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status.toUpperCase());
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const res = await request<Paginated<ApiTimeAdjustmentRequest>>(`/time-adjustment-requests?${qs.toString()}`);
  return { ...res, items: res.items.map(mapAdjustmentRequest) };
}

export async function approveAdjustmentRequest(id: string, reviewNote?: string): Promise<void> {
  await request(`/time-adjustment-requests/${id}/approve`, { method: 'PATCH', body: JSON.stringify({ reviewNote }) });
}

export async function rejectAdjustmentRequest(id: string, reviewNote: string): Promise<AdjustmentRequestRecord> {
  const r = await request<ApiTimeAdjustmentRequest>(`/time-adjustment-requests/${id}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ reviewNote }),
  });
  return mapAdjustmentRequest(r);
}

// Correção proativa (sem solicitação prévia do funcionário) — mesmo formato de
// createAdjustmentRequest, sem anexo (ProactiveCorrectionDto não aceita um no backend) e com
// `reason` sempre obrigatório.
export async function proactiveCorrection(
  employeeId: string,
  input: {
    targetDate: string;
    relatedEventId?: string;
    type: 'add_missing_punch' | 'correct_time' | 'remove_punch';
    requestedEventType?: TimePunchType;
    requestedTime?: string;
    reason: string;
  },
): Promise<void> {
  await request(`/employees/${employeeId}/time-events/correct`, {
    method: 'POST',
    body: JSON.stringify({
      targetDate: input.targetDate,
      relatedEventId: input.relatedEventId,
      type: input.type.toUpperCase(),
      requestedEventType: input.requestedEventType?.toUpperCase(),
      requestedTime: input.requestedTime,
      reason: input.reason,
    }),
  });
}

export async function listJustificationsForReview(params?: {
  status?: 'pending' | 'approved' | 'rejected';
  page?: number;
  pageSize?: number;
}): Promise<Paginated<JustificationRecord>> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status.toUpperCase());
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
  const query = qs.toString();
  const res = await request<Paginated<ApiTimeJustification>>(`/time-justifications${query ? `?${query}` : ''}`);
  return { ...res, items: res.items.map(mapJustification) };
}

export async function reviewJustification(id: string, decision: 'approve' | 'reject', reviewNote?: string): Promise<JustificationRecord> {
  const j = await request<ApiTimeJustification>(`/time-justifications/${id}/${decision}`, {
    method: 'PATCH',
    body: JSON.stringify({ reviewNote }),
  });
  return mapJustification(j);
}

export async function listTimeInconsistencies(): Promise<TimePunch[]> {
  const events = await request<ApiTimeEvent[]>('/time-events/inconsistencies');
  return events.map(mapTimePunch);
}

// Achado na revisão final de 14/09/2026: a aba de Correção Proativa usava listEmployees() (a
// listagem completa da empresa) como fonte do seletor de funcionário, mostrando mais opções do que
// as que um superior direto de fato consegue corrigir. Esta função é escopada no backend por
// TimeManagementAuthService.getManageableEmployeeIds() — ADMIN vê todos, um superior vê só seus
// subordinados diretos.
export async function listManageableEmployees(): Promise<{ id: string; fullName: string }[]> {
  return request<{ id: string; fullName: string }[]>('/time-management/manageable-employees');
}

// ---- Configuração administrativa (jornadas, locais de trabalho, regras da empresa) ----
export async function listWorkSchedules(params?: { employeeId?: string; managerId?: string }): Promise<WorkScheduleRecord[]> {
  const qs = new URLSearchParams({ pageSize: '100' });
  if (params?.employeeId) qs.set('employeeId', params.employeeId);
  if (params?.managerId) qs.set('managerId', params.managerId);
  const res = await request<Paginated<ApiWorkSchedule>>(`/work-schedules?${qs.toString()}`);
  return res.items.map(mapWorkSchedule);
}

export async function createWorkSchedule(input: {
  employeeId?: string;
  managerId?: string;
  name: string;
  weekDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  breakMinutes?: number;
  dailyMinutes: number;
  weeklyMinutes: number;
  toleranceMinutes?: number;
  allowOvertime?: boolean;
  maxOvertimeMinutesPerDay?: number;
  nightShift?: boolean;
  validFrom: string;
  validTo?: string;
}): Promise<WorkScheduleRecord> {
  const s = await request<ApiWorkSchedule>('/work-schedules', { method: 'POST', body: JSON.stringify(input) });
  return mapWorkSchedule(s);
}

export async function updateWorkSchedule(
  id: string,
  input: Partial<{
    employeeId: string;
    managerId: string;
    name: string;
    weekDays: number[];
    expectedStartTime: string;
    expectedEndTime: string;
    breakMinutes: number;
    dailyMinutes: number;
    weeklyMinutes: number;
    toleranceMinutes: number;
    allowOvertime: boolean;
    maxOvertimeMinutesPerDay: number;
    nightShift: boolean;
    validFrom: string;
    validTo: string;
  }>,
): Promise<WorkScheduleRecord> {
  const s = await request<ApiWorkSchedule>(`/work-schedules/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  return mapWorkSchedule(s);
}

export async function listWorkLocations(activeOnly?: boolean): Promise<WorkLocationRecord[]> {
  const qs = activeOnly ? '?active=true&pageSize=100' : '?pageSize=100';
  const res = await request<Paginated<ApiWorkLocation>>(`/work-locations${qs}`);
  return res.items.map(mapWorkLocation);
}

export async function createWorkLocation(input: {
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  active?: boolean;
}): Promise<WorkLocationRecord> {
  const l = await request<ApiWorkLocation>('/work-locations', { method: 'POST', body: JSON.stringify(input) });
  return mapWorkLocation(l);
}

export async function updateWorkLocation(
  id: string,
  input: Partial<{ name: string; latitude: number; longitude: number; radiusMeters: number; active: boolean }>,
): Promise<WorkLocationRecord> {
  const l = await request<ApiWorkLocation>(`/work-locations/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  return mapWorkLocation(l);
}

export async function getTimeTrackingSettings(managerId?: string): Promise<TimeTrackingSettingsRecord> {
  const qs = managerId ? `?managerId=${managerId}` : '';
  const s = await request<ApiTimeTrackingSettings>(`/time-tracking-settings${qs}`);
  return mapTimeTrackingSettings(s);
}

// Corpo montado campo a campo, NUNCA espalhando o objeto recebido: a validação de whitelist do
// Nest rejeita com 400 qualquer propriedade desconhecida no PATCH (foi exatamente esse o bug de
// "Salvar" encontrado na verificação em navegador de 14/09/2026, quando campos crus da resposta
// vazavam de volta no corpo). `inherited`, novo em 15/09/2026, é mais um campo que só existe na
// LEITURA e jamais pode voltar aqui.
export async function updateTimeTrackingSettings(
  input: Partial<TimeTrackingSettingsRecord>,
): Promise<TimeTrackingSettingsRecord> {
  const body: Record<string, unknown> = {
    requirePhoto: input.requirePhoto,
    requireLocation: input.requireLocation,
    allowLocationException: input.allowLocationException,
    allowExtraPeriods: input.allowExtraPeriods,
    maxAttachmentSizeBytes: input.maxAttachmentSizeBytes,
  };
  // managerId só quando de fato há um escopo de time — `null` (padrão da empresa) é omitido, não
  // enviado, porque o DTO do backend só aceita string.
  if (typeof input.managerId === 'string') body.managerId = input.managerId;
  const s = await request<ApiTimeTrackingSettings>('/time-tracking-settings', { method: 'PATCH', body: JSON.stringify(body) });
  return mapTimeTrackingSettings(s);
}

// "Eu tenho subordinados diretos?" — pergunta diferente de listManageableEmployees() (que, pra um
// ADMIN de acesso total, devolve a empresa inteira). Ver TimeManagementAuthService.hasDirectReports.
export async function hasDirectReports(): Promise<boolean> {
  const res = await request<{ hasDirectReports: boolean }>('/time-management/has-direct-reports');
  return res.hasDirectReports;
}

// ---- Vínculo do próprio login a um Employee (admin que ainda não pode bater ponto) ----
export async function linkMyEmployee(employeeId: string): Promise<void> {
  await request('/auth/me/employee-link', { method: 'PATCH', body: JSON.stringify({ employeeId }) });
}

// ---- Download de anexos/fotos ----
// O backend já devolve um `downloadUrl` pronto (path relativo, token de curta duração já
// embutido) em qualquer resposta que referencie um anexo/foto — nunca construído aqui a partir de
// um token cru (ver buildFileDownloadPath no backend, download-token.util.ts). Só prefixa a
// origem da API pra virar uma URL absoluta.
//
// NUNCA usar esse valor direto num <img src>/<a href> — `GET /file-assets/:id` exige o JWT de
// acesso normal (`JwtAuthGuard`, global) ALÉM do `?token=` de curto prazo, de propósito (ver
// files.controller.ts: o token de download é uma segunda camada, nunca substitui a autenticação
// normal). Um <img>/<a> disparado pelo próprio browser nunca consegue anexar um cabeçalho
// `Authorization` customizado — só uma chamada JS (`fetch`) consegue. Bug real encontrado só numa
// verificação de navegador de verdade (14/09/2026, Task 14): todo link/foto de anexo devolvia 401
// nesse formato, mascarado até então porque toda verificação anterior usava `curl` com um cabeçalho
// `Authorization` manual. Use `fetchProtectedFileObjectUrl()` abaixo em vez desta função
// diretamente em JSX — ela mantida exportada só como utilitário de baixo nível.
export function getFileDownloadUrl(record: { downloadUrl: string | null }): string | null {
  return record.downloadUrl ? `${API_URL}${record.downloadUrl}` : null;
}

// Busca o arquivo de verdade via fetch autenticado (Authorization: Bearer, com o mesmo retry de
// 401 de request() acima) e devolve um Object URL local (`URL.createObjectURL`) pronto pra usar em
// `<img src>` ou `window.open()` — o único jeito de honrar a exigência de dupla camada de
// autenticação do backend a partir de um elemento HTML normal. Quem chama é responsável por
// `URL.revokeObjectURL()` quando não precisar mais (evita vazamento de memória).
export async function fetchProtectedFileObjectUrl(downloadUrl: string, isRetry = false): Promise<string> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}${downloadUrl}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401 && !isRetry) {
    const renewed = await refreshOnce();
    if (renewed) return fetchProtectedFileObjectUrl(downloadUrl, true);
  }
  if (!res.ok) throw new Error(`Não foi possível carregar o arquivo (erro ${res.status}).`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ---- Custom Fields ----
export type CustomFieldType =
  | 'TEXT' | 'LONG_TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'DATETIME'
  | 'BOOLEAN' | 'SELECT' | 'MULTI_SELECT' | 'EMAIL' | 'PHONE' | 'CPF' | 'CNPJ';

export type CustomFieldEntity = 'client' | 'role' | 'employee';

export interface CustomFieldDefinition {
  id: string;
  entity: CustomFieldEntity;
  displayName: string;
  columnName: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue: string | null;
  description: string | null;
  configuration: { options?: string[] } | null;
  displayOrder: number;
  active: boolean;
}

export async function listCustomFieldDefinitions(entity: CustomFieldEntity): Promise<CustomFieldDefinition[]> {
  return request<CustomFieldDefinition[]>(`/custom-fields?entity=${entity}`);
}

export async function listActiveCustomFields(entity: CustomFieldEntity): Promise<CustomFieldDefinition[]> {
  return request<CustomFieldDefinition[]>(`/custom-fields/active?entity=${entity}`);
}

export async function createCustomFieldDefinition(dto: {
  entity: CustomFieldEntity;
  displayName: string;
  type: CustomFieldType;
  required?: boolean;
  defaultValue?: string;
  description?: string;
  configuration?: { options?: string[] };
}): Promise<CustomFieldDefinition> {
  return request<CustomFieldDefinition>('/custom-fields', { method: 'POST', body: JSON.stringify(dto) });
}

export async function updateCustomFieldDefinition(
  id: string,
  dto: Partial<{
    displayName: string; required: boolean; defaultValue: string | null; description: string;
    configuration: { options?: string[] }; displayOrder: number;
  }>,
): Promise<CustomFieldDefinition> {
  return request<CustomFieldDefinition>(`/custom-fields/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
}

export async function deactivateCustomFieldDefinition(id: string): Promise<CustomFieldDefinition> {
  return request<CustomFieldDefinition>(`/custom-fields/${id}/deactivate`, { method: 'PATCH' });
}

export async function activateCustomFieldDefinition(id: string): Promise<CustomFieldDefinition> {
  return request<CustomFieldDefinition>(`/custom-fields/${id}/activate`, { method: 'PATCH' });
}

export async function getCustomFieldFilledCount(id: string): Promise<number> {
  const res = await request<{ count: number }>(`/custom-fields/${id}/filled-count`);
  return res.count;
}

// Usado antes de salvar a edição de um campo de lista de opções, pra cada opção que estiver
// sendo removida — dá o número de registros que ficariam com o valor esvaziado, pro frontend
// avisar o admin antes de confirmar.
export async function getCustomFieldOptionUsageCount(id: string, option: string): Promise<number> {
  const res = await request<{ count: number }>(`/custom-fields/${id}/option-usage?option=${encodeURIComponent(option)}`);
  return res.count;
}

export async function deleteCustomFieldDefinition(id: string): Promise<void> {
  await request<void>(`/custom-fields/${id}`, { method: 'DELETE' });
}

// ---- Planos (GET /plans/me) ----
export interface PlanLimits {
  maxRoles: number | null; // null = sem limite
  maxEmployees: number | null;
  maxEmployeeLogins: number | null;
}

export interface PlanCatalogItem {
  tier: 'GRATIS' | 'BASICO' | 'PRO' | 'EMPRESARIAL';
  label: string;
  priceLabel: string;
  modules: string[];
  features: string[];
  limits: PlanLimits;
}

export interface MyPlan {
  current: { tier: 'GRATIS' | 'BASICO' | 'PRO' | 'EMPRESARIAL'; label: string; limits: PlanLimits };
  usage: { roles: number; employees: number; employeeLogins: number };
  // Catálogo inteiro (4 planos), sempre na mesma ordem crescente — a aba Assinatura usa isso pra
  // desenhar a comparação/upgrade de planos.
  catalog: PlanCatalogItem[];
}

export async function getMyPlan(): Promise<MyPlan> {
  return request<MyPlan>('/plans/me');
}
