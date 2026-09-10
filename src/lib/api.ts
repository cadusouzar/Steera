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
