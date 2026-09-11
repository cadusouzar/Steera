# Integração do Frontend de RH — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar as telas de RH (`Roles.tsx`, `EmployeesList.tsx`, `EmployeeForm.tsx`, `FinanceAndVacationModal.tsx`) ao backend real já construído, seguindo exatamente o padrão já usado pela integração de Clientes.

**Architecture:** `src/lib/api.ts` ganha tipos/funções novas por recurso (Cargos, Funcionários, Advertências, Pagamentos, Recorrência, Férias), mesmo padrão `Api* → map*() → tipo exportado` já usado para Clientes. Cada página troca `useState` com array fixo por `useCallback` de carregamento + `useEffect`, com `isLoading`/`loadError`/`actionError`, mesmo padrão de `ClientsList.tsx`.

**Tech Stack:** React 18, TypeScript, `fetch` via o helper `request()` já existente em `api.ts`.

**Spec:** `docs/superpowers/specs/2026-09-11-hr-frontend-integration-design.md`

## Global Constraints

- Sem suíte de testes de frontend configurada — cada task termina com uma verificação manual no navegador (dev server rodando em `http://localhost:5173`, backend em `http://localhost:3001`), cobrindo o caminho feliz e pelo menos um erro esperado.
- Nunca remoção otimista de dado antes da confirmação do backend (mesma regra já aplicada em Clientes).
- CPF, dados bancários e detalhes completos do funcionário só aparecem na tela de detalhes (`GET /employees/:id`) — a listagem usa sempre o formato mascarado que o backend já devolve.
- Cargo/funcionário nunca são excluídos de verdade pela UI — sempre inativar/reativar.
- Roteamento sempre via `react-router-dom`, ícones sempre via `lucide-react`, estilização sempre com classes Tailwind inline — nenhuma biblioteca nova.
- Backend já está rodando localmente (`npm run start:dev` em `backend/`) durante toda a implementação, para permitir verificação manual a cada task.

---

## Task 1: `src/lib/api.ts` — tipos e funções para Cargos, Funcionários, Advertências, Pagamentos, Recorrência e Férias

**Files:**
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: todos os tipos e funções abaixo, consumidos pelas Tasks 2-6.

- [ ] **Step 1: Adicionar os helpers de CPF e dia de pagamento**

No final de `src/lib/api.ts`, antes da seção `// ---- Reports ----`, adicionar:

```ts
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
```

- [ ] **Step 2: Adicionar as shapes cruas (`Api*`) e os tipos exportados**

```ts
// ---- Shapes returned by the backend (RH) ----
interface ApiRole {
  id: string; name: string; department: string; colorHex: string;
  description: string | null; active: boolean;
}
interface ApiEmployeeListItem {
  id: string; fullName: string; roleId: string; department: string;
  contractType: 'CLT' | 'PJ' | 'ESTAGIO'; status: 'ACTIVE' | 'INACTIVE';
  cpfMasked: string; baseValue: number | string;
}
interface ApiEmployeeDetail {
  id: string; fullName: string; cpf: string; roleId: string;
  email: string | null; phone: string | null; address: string | null;
  contractType: 'CLT' | 'PJ' | 'ESTAGIO'; admissionDate: string; terminationDate: string | null;
  status: 'ACTIVE' | 'INACTIVE'; department: string; baseValue: number | string;
  paymentDueDay: number; payOnLastBusinessDay: boolean; bankDetails: string | null;
  salaryRecurrenceEnabled: boolean;
}
interface ApiWarning { id: string; occurredAt: string; reason: string; }
interface ApiEmployeePayment {
  id: string; description: string; amount: number | string; dueDate: string;
  derivedStatus: 'pending' | 'paid' | 'overdue';
  recurringPaymentId?: string | null; referenceYear?: number | null; referenceMonth?: number | null;
}
interface ApiEmployeeRecurringPayment {
  id: string; description: string; amount: number | string; dueDay: number; status: 'ACTIVE' | 'INACTIVE';
}
interface ApiVacationStatus {
  monthsWorked: number; acquisitionComplete: boolean; totalAcquiredDays: number;
  proportionalDays: number; balanceDays: number; oneThirdBonus: number | string;
}
interface ApiVacationSchedule {
  id: string; startDate: string; endDate: string; daysCount: number;
  status: 'SCHEDULED' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

// ---- Shapes the UI works with (RH) ----
export interface Role {
  id: string; name: string; department: string; colorHex: string;
  description?: string; active: boolean;
}
export interface EmployeeListItem {
  id: string; fullName: string; roleId: string; department: string;
  contractType: 'clt' | 'pj' | 'estagio'; status: 'active' | 'inactive';
  cpfMasked: string; baseValue: number;
}
export interface EmployeeDetail {
  id: string; fullName: string; cpf: string; roleId: string;
  email?: string; phone?: string; address?: string;
  contractType: 'clt' | 'pj' | 'estagio'; admissionDate: string;
  terminationDate?: string | null; status: 'active' | 'inactive'; department: string;
  baseValue: number; paymentDay: '5' | '15' | '20' | 'last'; bankDetails?: string;
  salaryRecurrenceEnabled: boolean;
}
export interface EmployeeWarning { id: string; occurredAt: string; reason: string; }
export interface EmployeePaymentRecord {
  id: string; description: string; amount: number; dueDate: string;
  status: 'pending' | 'paid' | 'overdue';
  recurringPaymentId?: string | null; referenceYear?: number | null; referenceMonth?: number | null;
}
export interface EmployeeRecurringPaymentRecord {
  id: string; description: string; amount: number; dueDay: number; status: 'active' | 'inactive';
}
export interface VacationStatus {
  monthsWorked: number; acquisitionComplete: boolean; totalAcquiredDays: number;
  proportionalDays: number; balanceDays: number; oneThirdBonus: number;
}
export interface VacationScheduleRecord {
  id: string; startDate: string; endDate: string; daysCount: number;
  status: 'scheduled' | 'approved' | 'in_progress' | 'completed' | 'cancelled';
}

export interface EmployeeFormInput {
  fullName: string; cpf: string; roleId: string; email?: string; phone?: string; address?: string;
  contractType: 'clt' | 'pj' | 'estagio'; admissionDate: string; department: string;
  baseValue: number; paymentDay: '5' | '15' | '20' | 'last'; bankDetails?: string;
  salaryRecurrenceEnabled?: boolean;
}
```

- [ ] **Step 3: Adicionar os mapeadores**

```ts
function mapRole(r: ApiRole): Role {
  return {
    id: r.id, name: r.name, department: r.department, colorHex: r.colorHex,
    description: r.description ?? undefined, active: r.active,
  };
}

function mapEmployeeListItem(e: ApiEmployeeListItem): EmployeeListItem {
  return {
    id: e.id, fullName: e.fullName, roleId: e.roleId, department: e.department,
    contractType: e.contractType.toLowerCase() as EmployeeListItem['contractType'],
    status: e.status.toLowerCase() as EmployeeListItem['status'],
    cpfMasked: e.cpfMasked, baseValue: Number(e.baseValue),
  };
}

function mapEmployeeDetail(e: ApiEmployeeDetail): EmployeeDetail {
  return {
    id: e.id, fullName: e.fullName, cpf: formatCpf(e.cpf), roleId: e.roleId,
    email: e.email ?? undefined, phone: e.phone ?? undefined, address: e.address ?? undefined,
    contractType: e.contractType.toLowerCase() as EmployeeDetail['contractType'],
    admissionDate: e.admissionDate.slice(0, 10),
    terminationDate: e.terminationDate ? e.terminationDate.slice(0, 10) : null,
    status: e.status.toLowerCase() as EmployeeDetail['status'],
    department: e.department, baseValue: Number(e.baseValue),
    paymentDay: toPaymentDay(e.paymentDueDay, e.payOnLastBusinessDay),
    bankDetails: e.bankDetails ?? undefined,
    salaryRecurrenceEnabled: e.salaryRecurrenceEnabled,
  };
}

function toEmployeeDto(input: EmployeeFormInput) {
  const { paymentDueDay, payOnLastBusinessDay } = fromPaymentDay(input.paymentDay);
  return {
    fullName: input.fullName, cpf: stripCpf(input.cpf), roleId: input.roleId,
    email: input.email || undefined, phone: input.phone || undefined, address: input.address || undefined,
    contractType: input.contractType.toUpperCase(), admissionDate: input.admissionDate,
    department: input.department, baseValue: input.baseValue, paymentDueDay, payOnLastBusinessDay,
    bankDetails: input.bankDetails || undefined, salaryRecurrenceEnabled: input.salaryRecurrenceEnabled,
  };
}

function mapWarning(w: ApiWarning): EmployeeWarning {
  return { id: w.id, occurredAt: w.occurredAt.slice(0, 10), reason: w.reason };
}

function mapEmployeePayment(p: ApiEmployeePayment): EmployeePaymentRecord {
  return {
    id: p.id, description: p.description, amount: Number(p.amount), dueDate: p.dueDate.slice(0, 10),
    status: p.derivedStatus, recurringPaymentId: p.recurringPaymentId ?? null,
    referenceYear: p.referenceYear ?? null, referenceMonth: p.referenceMonth ?? null,
  };
}

function mapEmployeeRecurringPayment(r: ApiEmployeeRecurringPayment): EmployeeRecurringPaymentRecord {
  return {
    id: r.id, description: r.description, amount: Number(r.amount), dueDay: r.dueDay,
    status: r.status.toLowerCase() as EmployeeRecurringPaymentRecord['status'],
  };
}

function mapVacationStatus(v: ApiVacationStatus): VacationStatus {
  return {
    monthsWorked: v.monthsWorked, acquisitionComplete: v.acquisitionComplete,
    totalAcquiredDays: v.totalAcquiredDays, proportionalDays: v.proportionalDays,
    balanceDays: v.balanceDays, oneThirdBonus: Number(v.oneThirdBonus),
  };
}

function mapVacationSchedule(s: ApiVacationSchedule): VacationScheduleRecord {
  return {
    id: s.id, startDate: s.startDate.slice(0, 10), endDate: s.endDate.slice(0, 10),
    daysCount: s.daysCount, status: s.status.toLowerCase() as VacationScheduleRecord['status'],
  };
}
```

- [ ] **Step 4: Adicionar as funções de API**

```ts
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
export async function getVacationStatus(employeeId: string): Promise<VacationStatus> {
  const v = await request<ApiVacationStatus>(`/employees/${employeeId}/vacation/status`);
  return mapVacationStatus(v);
}

export async function simulateVacation(
  employeeId: string,
  dto: { startDate: string; endDate: string; daysCount: number },
): Promise<VacationStatus & { sufficientBalance: boolean }> {
  const v = await request<ApiVacationStatus & { sufficientBalance: boolean }>(
    `/employees/${employeeId}/vacation/simulate`,
    { method: 'POST', body: JSON.stringify(dto) },
  );
  return { ...mapVacationStatus(v), sufficientBalance: v.sufficientBalance };
}

export async function scheduleVacation(
  employeeId: string,
  dto: { startDate: string; endDate: string; daysCount: number },
): Promise<VacationScheduleRecord> {
  const s = await request<ApiVacationSchedule>(`/employees/${employeeId}/vacation/schedule`, { method: 'POST', body: JSON.stringify(dto) });
  return mapVacationSchedule(s);
}

export async function listVacationSchedules(employeeId: string): Promise<VacationScheduleRecord[]> {
  const items = await request<ApiVacationSchedule[]>(`/employees/${employeeId}/vacation/schedules`);
  return items.map(mapVacationSchedule);
}
```

- [ ] **Step 5: Verificar que o projeto compila**

Run: `cd /c/Users/cadus/Desktop/product && npx tsc --noEmit -p .`
Expected: sem erros (essas funções ainda não são usadas por nenhuma tela, então não há erro de tipo cruzado ainda).

- [ ] **Step 6: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(frontend): add API client functions for Cargos, Funcionários, Advertências, Pagamentos e Férias"
```

---

## Task 2: `Roles.tsx` — Cargos reais

**Files:**
- Modify: `src/pages/app/Roles.tsx`

**Interfaces:**
- Consumes: `api.listRoles`, `api.createRole`, `api.updateRole`, `api.deactivateRole`, `api.reactivateRole`, tipo `Role` (Task 1).

- [ ] **Step 1: Trocar os imports e remover o mock**

Substituir as linhas 1-33 (imports, `interface Role` local, `mockRoles`, `AVAILABLE_COLORS` como classes Tailwind) por:

```tsx
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, X, FileQuestion, Briefcase, ChevronRight, Check, Ban, RotateCcw, Loader2 } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import * as api from '../../lib/api';
import type { Role } from '../../lib/api';

const COLOR_SWATCHES = [
  '#3B82F6', '#A855F7', '#EC4899', '#EF4444',
  '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#2563EB',
];
```

(`Trash2` deixa de ser usado neste arquivo — trocado por `Ban`/`RotateCcw`, mais adequados para inativar/reativar.)

- [ ] **Step 2: Trocar o estado inicial e adicionar o carregamento**

Substituir:

```tsx
const Roles = () => {
  const [roles, setRoles] = useState<Role[]>(mockRoles);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Drawer state
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [newRole, setNewRole] = useState({ name: '', department: '' });
```

por:

```tsx
const Roles = () => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Drawer state
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isConfirmingDeactivate, setIsConfirmingDeactivate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [newRole, setNewRole] = useState({ name: '', department: '', colorHex: '#2563EB', description: '' });

  const loadRoles = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setRoles(await api.listRoles());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os cargos.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);
```

- [ ] **Step 3: Trocar `isConfirmingDelete` por `isConfirmingDeactivate` no `useEffect` de reset**

Substituir:

```tsx
  // Reset delete confirmation when drawer changes
  useEffect(() => {
    setIsConfirmingDelete(false);
  }, [selectedRole]);
```

por:

```tsx
  // Reset deactivate confirmation when drawer changes
  useEffect(() => {
    setIsConfirmingDeactivate(false);
  }, [selectedRole]);
```

- [ ] **Step 4: Trocar `handleAddRole`, `handleUpdateRole`, `handleDeleteRole` pelas versões assíncronas**

Substituir os três handlers por:

```tsx
  const handleAddRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRole.name.trim() || !newRole.department.trim() || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const created = await api.createRole({
        name: newRole.name, department: newRole.department,
        colorHex: newRole.colorHex, description: newRole.description || undefined,
      });
      setRoles(prev => [...prev, created]);
      setNewRole({ name: '', department: '', colorHex: '#2563EB', description: '' });
      setIsModalOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível criar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateRole = async (updatedRole: Role) => {
    setIsSaving(true);
    setActionError(null);
    try {
      const saved = await api.updateRole(updatedRole.id, {
        name: updatedRole.name, department: updatedRole.department,
        colorHex: updatedRole.colorHex, description: updatedRole.description,
      });
      setRoles(prev => prev.map(r => r.id === saved.id ? saved : r));
      setSelectedRole(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivateRole = async (id: string) => {
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.deactivateRole(id);
      setRoles(prev => prev.map(r => r.id === id ? updated : r));
      setSelectedRole(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível inativar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReactivateRole = async (id: string) => {
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.reactivateRole(id);
      setRoles(prev => prev.map(r => r.id === id ? updated : r));
      setSelectedRole(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível reativar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };
```

- [ ] **Step 5: Mostrar loading/erro de carregamento e o selo de status na tabela**

Na seção "Data Grid or Empty State", envolver a tabela existente assim (mantendo a estrutura interna do `<table>` como está, só adicionando os estados de loading/erro antes dela e uma coluna de status):

```tsx
        {loadError && (
          <div className="glass-panel rounded-3xl border border-red-500/30 bg-red-500/5 p-6 mb-6 text-red-600 dark:text-red-400 text-sm">
            {loadError}
          </div>
        )}

        <div className="glass-panel rounded-3xl border border-border/60 overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="py-24 flex items-center justify-center text-muted">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : filteredRoles.length > 0 ? (
```

(o `) : (` do empty state original continua igual — só a condição do topo ganhou o `isLoading ? ... :` na frente.)

Dentro do `<thead>`, adicionar uma coluna de status entre "Departamento" e "Ações":

```tsx
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Status
                    </th>
```

E dentro de cada `<tr>` do `<tbody>`, adicionar a célula correspondente (entre a célula de Departamento e a de Ações):

```tsx
                        <td className="px-8 py-6">
                          {role.active ? (
                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500" /> ATIVO
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-secondary text-foreground/60 border border-border/60">
                              <div className="w-1.5 h-1.5 rounded-full bg-foreground/40" /> INATIVO
                            </span>
                          )}
                        </td>
```

O `<div className={... ${role.color || 'bg-accent'}}` que hoje mostra a cor como classe Tailwind vira um `<div style={{ backgroundColor: role.colorHex }}>` (mesma posição no JSX, tanto na linha da tabela quanto no cabeçalho do drawer).

- [ ] **Step 6: Trocar o formulário "Novo Cargo" para incluir cor e descrição**

No formulário do modal (dentro do `<form onSubmit={handleAddRole}>`), depois do campo "Departamento" e antes do `<div className="pt-6 flex gap-3">`, adicionar:

```tsx
                  <div>
                    <label className="block text-sm font-semibold text-foreground/90 mb-2">Cor de Identificação</label>
                    <div className="flex flex-wrap gap-3 mb-3">
                      {COLOR_SWATCHES.map(hex => (
                        <button
                          key={hex} type="button"
                          onClick={() => setNewRole({ ...newRole, colorHex: hex })}
                          style={{ backgroundColor: hex }}
                          className={`w-9 h-9 rounded-full transition-transform flex items-center justify-center ${newRole.colorHex === hex ? 'ring-4 ring-primary/30 scale-110' : 'hover:scale-105 opacity-90'}`}
                        >
                          {newRole.colorHex === hex && <Check size={14} className="text-white" />}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text" value={newRole.colorHex}
                      onChange={(e) => setNewRole({ ...newRole, colorHex: e.target.value })}
                      pattern="^#[0-9A-Fa-f]{6}$" placeholder="#2563EB"
                      className="w-32 bg-background border border-border/80 rounded-xl px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-foreground/90 mb-2">Descrição (opcional)</label>
                    <textarea
                      rows={3} value={newRole.description}
                      onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                      className="w-full bg-background border border-border/80 rounded-xl p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                      placeholder="Atribuições e responsabilidades..."
                    />
                  </div>
```

E o botão "Salvar Cargo" ganha `disabled={!newRole.name.trim() || !newRole.department.trim() || isSaving}` e mostra `{isSaving ? 'Salvando...' : 'Salvar Cargo'}`.

- [ ] **Step 7: Trocar a paleta de cores do drawer e o rodapé de ações**

No drawer, a seção "Cores" troca `AVAILABLE_COLORS.map(color => ...)` por `COLOR_SWATCHES.map(hex => ...)`, mesmo padrão de botão do Step 6, atualizando `selectedRole.colorHex` em vez de `selectedRole.color`.

O rodapé do drawer (hoje "Excluir Cargo" com confirmação em duas etapas) vira:

```tsx
                <div className="p-6 md:p-8 border-t border-border/40 bg-secondary/10 flex items-center justify-between gap-4">
                  {selectedRole.active ? (
                    isConfirmingDeactivate ? (
                      <motion.button
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        onClick={() => handleDeactivateRole(selectedRole.id)}
                        onMouseLeave={() => setIsConfirmingDeactivate(false)}
                        disabled={isSaving}
                        className="px-5 py-3.5 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 text-sm flex items-center gap-2 disabled:opacity-60"
                      >
                        <Ban size={16} /> Confirmar Inativação
                      </motion.button>
                    ) : (
                      <button
                        onClick={() => setIsConfirmingDeactivate(true)}
                        className="px-5 py-3.5 rounded-xl font-medium text-red-500 hover:bg-red-500/10 transition-colors text-sm flex items-center gap-2"
                      >
                        <Ban size={16} /> Inativar Cargo
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => handleReactivateRole(selectedRole.id)}
                      disabled={isSaving}
                      className="px-5 py-3.5 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 text-sm flex items-center gap-2 disabled:opacity-60"
                    >
                      <RotateCcw size={16} /> Reativar Cargo
                    </button>
                  )}

                  <div className="flex gap-3 ml-auto">
                    <button onClick={() => setSelectedRole(null)} className="px-5 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm">
                      Cancelar
                    </button>
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => handleUpdateRole(selectedRole)}
                      disabled={isSaving}
                      className="px-5 py-3.5 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 text-sm disabled:opacity-60"
                    >
                      {isSaving ? 'Salvando...' : 'Salvar'}
                    </motion.button>
                  </div>
                </div>
```

Se `actionError` estiver definido, mostrar um banner de erro logo acima desse rodapé (mesmo estilo do banner de `loadError` do Step 5).

- [ ] **Step 8: Verificação manual no navegador**

Com o backend e o `npm run dev` do frontend rodando:
1. Abrir `/app/cargos` — deve carregar a lista vazia (ou os cargos já criados manualmente antes) em vez do mock antigo.
2. Criar um cargo novo com nome, departamento e uma cor da paleta — confirmar que aparece na tabela.
3. Abrir o drawer, editar a descrição, salvar — confirmar que persiste ao recarregar a página.
4. Inativar o cargo (duas etapas) — confirmar que o selo muda para "INATIVO" e o botão vira "Reativar Cargo".
5. Reativar — confirmar que volta a "ATIVO".
6. Tentar criar dois cargos ativos com o mesmo nome — confirmar que aparece mensagem de erro (409) sem fechar o modal.

- [ ] **Step 9: Commit**

```bash
git add src/pages/app/Roles.tsx
git commit -m "feat(frontend): connect Roles page to the real Cargos backend"
```

---

## Task 3: `EmployeesList.tsx` — listagem, detalhes e advertências reais

**Files:**
- Modify: `src/pages/app/EmployeesList.tsx`

**Interfaces:**
- Consumes: `api.listEmployees`, `api.getEmployee`, `api.updateEmployee`, `api.deactivateEmployee`, `api.reactivateEmployee`, `api.listActiveRoles`, `api.listWarnings`, `api.createWarning` (Task 1).
- Produces: continua exportando `Employee`-shaped data para `FinanceAndVacationModal` (Task 5/6) — agora como `EmployeeDetail & { warnings: EmployeeWarning[] }`.

- [ ] **Step 1: Trocar imports, remover o mock e os tipos locais**

Remover as interfaces locais `Warning`, `Payment`, `Employee` e o array `initialEmployees`. Trocar os imports do topo por:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Filter, X, AlertCircle, Briefcase, ChevronRight, Edit2, Save, DollarSign, RefreshCw, Loader2, Ban, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import CustomSelect from '../../components/CustomSelect';
import FinanceAndVacationModal from '../../components/FinanceAndVacationModal';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import * as api from '../../lib/api';
import type { EmployeeDetail, EmployeeListItem, EmployeeWarning, Role } from '../../lib/api';

export interface Employee extends EmployeeDetail {
  warnings: EmployeeWarning[];
}

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
```

(A interface `Employee` exportada continua existindo — como antes — porque `FinanceAndVacationModal` a consome; só o formato interno mudou.)

- [ ] **Step 2: Trocar o estado do componente e adicionar o carregamento**

Substituir o bloco de `useState`s do topo do componente por:

```tsx
const EmployeesList = () => {
  const [employeeItems, setEmployeeItems] = useState<EmployeeListItem[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Drawer state
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isDrawerLoading, setIsDrawerLoading] = useState(false);

  // Finance Modal state
  const [financeEmployeeId, setFinanceEmployeeId] = useState<string | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});

  // Warning modal state
  const [warningModalOpen, setWarningModalOpen] = useState(false);
  const [warningDate, setWarningDate] = useState('');
  const [warningReason, setWarningReason] = useState('');

  const roleNameById = (roleId: string) => roles.find(r => r.id === roleId)?.name ?? '(cargo inativo)';

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [items, activeRoles] = await Promise.all([api.listEmployees(), api.listActiveRoles()]);
      setEmployeeItems(items);
      setRoles(activeRoles);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os funcionários.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openEmployeeDetail = async (id: string) => {
    setIsDrawerLoading(true);
    setActionError(null);
    try {
      const [detail, warnings] = await Promise.all([api.getEmployee(id), api.listWarnings(id)]);
      setSelectedEmployee({ ...detail, warnings });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível carregar o funcionário.');
    } finally {
      setIsDrawerLoading(false);
    }
  };
```

- [ ] **Step 3: Trocar `useEscapeKey`/`useEffect` de scroll e `filteredEmployees` para usar `employeeItems`**

```tsx
  useEscapeKey(() => {
    setSelectedEmployee(null);
    setFinanceEmployeeId(null);
    setWarningModalOpen(false);
  });

  useEffect(() => {
    if (selectedEmployee || warningModalOpen || financeEmployeeId || isDrawerLoading) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedEmployee, warningModalOpen, financeEmployeeId, isDrawerLoading]);

  useEffect(() => {
    if (!selectedEmployee) setIsEditing(false);
  }, [selectedEmployee]);

  const filteredEmployees = employeeItems.filter(emp => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return emp.fullName.toLowerCase().includes(lowerQuery) ||
      roleNameById(emp.roleId).toLowerCase().includes(lowerQuery) ||
      emp.department.toLowerCase().includes(lowerQuery);
  });
```

- [ ] **Step 4: Trocar os handlers de edição, inativação/reativação e advertência**

```tsx
  const handleEditClick = () => {
    setEditForm(selectedEmployee!);
    setIsEditing(true);
  };

  const handleCancelEdit = () => setIsEditing(false);

  const handleSaveEdit = async () => {
    if (!selectedEmployee || !editForm.fullName || !editForm.cpf || !editForm.roleId || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.updateEmployee(selectedEmployee.id, {
        fullName: editForm.fullName, cpf: editForm.cpf, roleId: editForm.roleId,
        email: editForm.email, phone: editForm.phone, address: editForm.address,
        department: editForm.department, contractType: editForm.contractType,
        admissionDate: editForm.admissionDate, baseValue: editForm.baseValue,
        paymentDay: editForm.paymentDay, bankDetails: editForm.bankDetails,
        salaryRecurrenceEnabled: editForm.salaryRecurrenceEnabled,
      });

      // Ligar/desligar a recorrência automática de salário nesta edição.
      if (editForm.salaryRecurrenceEnabled !== selectedEmployee.salaryRecurrenceEnabled) {
        const recurrences = await api.listEmployeeRecurringPayments(selectedEmployee.id);
        const salaryRecurrence = recurrences.filter(r => r.description === 'Salário').pop();
        if (editForm.salaryRecurrenceEnabled && !salaryRecurrence) {
          await api.createEmployeeRecurringPayment(selectedEmployee.id, {
            description: 'Salário', amount: updated.baseValue,
            dueDay: updated.paymentDay === 'last' ? 31 : Number(updated.paymentDay),
          });
        } else if (!editForm.salaryRecurrenceEnabled && salaryRecurrence?.status === 'active') {
          await api.deactivateEmployeeRecurringPayment(salaryRecurrence.id);
        }
      }

      const warnings = await api.listWarnings(selectedEmployee.id);
      setSelectedEmployee({ ...updated, warnings });
      setEmployeeItems(prev => prev.map(e => e.id === updated.id
        ? { id: updated.id, fullName: updated.fullName, roleId: updated.roleId, department: updated.department, contractType: updated.contractType, status: updated.status, cpfMasked: e.cpfMasked, baseValue: updated.baseValue }
        : e));
      setIsEditing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivateEmployee = async () => {
    if (!selectedEmployee || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.deactivateEmployee(selectedEmployee.id);
      setSelectedEmployee(prev => prev ? { ...prev, ...updated } : prev);
      setEmployeeItems(prev => prev.map(e => e.id === updated.id ? { ...e, status: updated.status } : e));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível inativar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReactivateEmployee = async () => {
    if (!selectedEmployee || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.reactivateEmployee(selectedEmployee.id);
      setSelectedEmployee(prev => prev ? { ...prev, ...updated } : prev);
      setEmployeeItems(prev => prev.map(e => e.id === updated.id ? { ...e, status: updated.status } : e));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível reativar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };

  const openWarning = () => {
    setWarningDate(new Date().toISOString().split('T')[0]);
    setWarningReason('');
    setWarningModalOpen(true);
  };

  const handleAddWarning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !warningDate || !warningReason || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const created = await api.createWarning(selectedEmployee.id, { occurredAt: warningDate, reason: warningReason });
      setSelectedEmployee({ ...selectedEmployee, warnings: [...selectedEmployee.warnings, created] });
      setWarningModalOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível registrar a advertência.');
    } finally {
      setIsSaving(false);
    }
  };
```

Remover `handleMarkAsPaid`/`handleScheduleVacation` deste arquivo — essas ações agora vivem inteiramente dentro de `FinanceAndVacationModal` (Task 5/6), que passa a buscar seus próprios dados em vez de recebê-los por props.

- [ ] **Step 5: Trocar a tabela para usar `filteredEmployees` (agora `EmployeeListItem[]`) e mostrar loading/erro**

Na tabela, `emp.name` vira `emp.fullName`, `emp.role` vira `roleNameById(emp.roleId)`, `emp.salary` vira `formatCurrency(emp.baseValue)`, `emp.salaryRecurrence !== false` some (a listagem não expõe mais essa informação — a badge "Recorrente/Manual" é removida da tabela; ela já vai aparecer corretamente na aba de pagamentos do modal financeiro). `onClick={() => setFinanceEmployee(emp)}` vira `onClick={() => setFinanceEmployeeId(emp.id)}`; `onDoubleClick`/botão "Detalhes" chamam `openEmployeeDetail(emp.id)`.

Envolver a `<table>` com o mesmo padrão de loading/erro do Task 2 (Step 5 daquela task), usando `isLoading`/`loadError` deste componente.

- [ ] **Step 6: Trocar o drawer de detalhes para usar os campos de `EmployeeDetail`**

No cabeçalho e no modo visualização, trocar todo `selectedEmployee.name` por `selectedEmployee.fullName`, `selectedEmployee.role` por `roleNameById(selectedEmployee.roleId)`, `selectedEmployee.salary` por `formatCurrency(selectedEmployee.baseValue)`. O card "Financeiro" mostra `selectedEmployee.salaryRecurrenceEnabled ? 'Ativada (Mensal)' : 'Desativada'` no lugar de `salaryRecurrence !== false`.

No modo edição, o campo de texto livre "Cargo" vira um `CustomSelect` carregado de `roles` (mesmo componente já usado para status/tipo de contrato):

```tsx
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Cargo</label>
                                <CustomSelect
                                  value={editForm.roleId || ''}
                                  onChange={(val) => {
                                    const role = roles.find(r => r.id === val);
                                    setEditForm({ ...editForm, roleId: val, department: role?.department ?? editForm.department });
                                  }}
                                  options={roles.map(r => ({ value: r.id, label: `${r.name} (${r.department})` }))}
                                  className="!py-2.5 !px-3"
                                />
                              </div>
```

O campo "Recorrência Automática" no formulário de edição passa a atualizar `editForm.salaryRecurrenceEnabled` (era `salaryRecurrence`).

O botão "Salvar Alterações" do rodapé de edição chama `handleSaveEdit` (já assíncrono) e mostra `disabled={isSaving}`/texto "Salvando...".

- [ ] **Step 7: Trocar o rodapé de status por botões de inativar/reativar**

O card "Status Atual" no topo do drawer (fora do modo edição) ganha, ao lado do selo ATIVO/INATIVO, um botão:

```tsx
                        selectedEmployee.status === 'active' ? (
                          <button onClick={handleDeactivateEmployee} disabled={isSaving} className="ml-3 text-xs font-bold text-red-500 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 disabled:opacity-60">
                            <Ban size={12} /> Inativar
                          </button>
                        ) : (
                          <button onClick={handleReactivateEmployee} disabled={isSaving} className="ml-3 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 disabled:opacity-60">
                            <RotateCcw size={12} /> Reativar
                          </button>
                        )
```

(mantendo o selo ATIVO/INATIVO como já está, só adicionando o botão ao lado, fora do modo edição.)

- [ ] **Step 8: Trocar o `FinanceAndVacationModal` para receber só o id**

```tsx
      {financeEmployeeId && createPortal(
        <FinanceAndVacationModal
          employeeId={financeEmployeeId}
          onClose={() => setFinanceEmployeeId(null)}
        />,
        document.body
      )}
```

(A Task 5/6 reescreve `FinanceAndVacationModal` para buscar seus próprios dados a partir de `employeeId`, em vez de receber `employee`/`onMarkAsPaid`/`onScheduleVacation` como props.)

- [ ] **Step 9: Verificação manual no navegador**

1. Abrir `/app/funcionarios` — lista carrega do backend (vazia se nenhum funcionário foi criado ainda pela Task 4).
2. Se já houver ao menos um funcionário (criar um rapidamente via Task 4 antes de continuar, ou via Prisma Studio), abrir os detalhes — CPF completo e dados bancários aparecem só aqui, não na listagem.
3. Editar um campo simples (telefone) e salvar — confirmar que persiste.
4. Trocar o cargo no formulário de edição — confirmar que o departamento é preenchido automaticamente, mas continua editável.
5. Inativar o funcionário — confirmar selo e botão mudam; reativar — confirmar que volta.
6. Registrar uma advertência — confirmar que aparece na lista imediatamente.
7. Ligar/desligar o toggle de recorrência automática numa edição — confirmar (via Prisma Studio ou na aba de pagamentos, depois da Task 5) que uma `EmployeeRecurringPayment` "Salário" foi criada/pausada.

- [ ] **Step 10: Commit**

```bash
git add src/pages/app/EmployeesList.tsx
git commit -m "feat(frontend): connect EmployeesList page to the real Funcionários backend"
```

---

## Task 4: `EmployeeForm.tsx` — cadastro real de funcionário

**Files:**
- Modify: `src/pages/app/EmployeeForm.tsx`

**Interfaces:**
- Consumes: `api.listActiveRoles`, `api.createEmployee`, `api.createEmployeeRecurringPayment` (Task 1).

- [ ] **Step 1: Trocar imports e adicionar estado controlado para todos os campos**

```tsx
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, User, Briefcase, DollarSign, AlertTriangle, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CustomSelect from '../../components/CustomSelect';
import * as api from '../../lib/api';
import type { Role } from '../../lib/api';

const EmployeeForm = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('pessoal');
  const [roles, setRoles] = useState<Role[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Dados Pessoais
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // Cargo & Vínculo
  const [roleId, setRoleId] = useState('');
  const [department, setDepartment] = useState('');
  const [admissionDate, setAdmissionDate] = useState('');
  const [contractType, setContractType] = useState<'clt' | 'pj' | 'estagio'>('clt');

  // Financeiro
  const [baseValue, setBaseValue] = useState('');
  const [paymentDay, setPaymentDay] = useState<'5' | '15' | '20' | 'last'>('5');
  const [bankDetails, setBankDetails] = useState('');
  const [salaryRecurrenceEnabled, setSalaryRecurrenceEnabled] = useState(true);

  useEffect(() => {
    api.listActiveRoles().then(setRoles).catch(() => setRoles([]));
  }, []);

  const tabs = [
    { id: 'pessoal', label: 'Dados Pessoais', icon: <User size={16} /> },
    { id: 'vinculo', label: 'Cargo & Vínculo', icon: <Briefcase size={16} /> },
    { id: 'financeiro', label: 'Financeiro', icon: <DollarSign size={16} /> },
    { id: 'advertencias', label: 'Advertências', icon: <AlertTriangle size={16} /> },
  ];
```

- [ ] **Step 2: Trocar `handleSave` pela versão real**

```tsx
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !cpf || !roleId || !admissionDate || !department || !baseValue || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const created = await api.createEmployee({
        fullName, cpf, roleId, email: email || undefined, phone: phone || undefined,
        address: address || undefined, contractType, admissionDate, department,
        baseValue: Number(baseValue), paymentDay, bankDetails: bankDetails || undefined,
        salaryRecurrenceEnabled,
      });

      if (salaryRecurrenceEnabled) {
        try {
          await api.createEmployeeRecurringPayment(created.id, {
            description: 'Salário', amount: created.baseValue,
            dueDay: paymentDay === 'last' ? 31 : Number(paymentDay),
          });
        } catch {
          // Funcionário já foi criado — a recorrência pode ser configurada depois na aba de pagamentos.
        }
      }

      navigate('/app/funcionarios');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Não foi possível salvar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };
```

- [ ] **Step 3: Trocar os inputs não controlados por controlados, aba "Dados Pessoais"**

Cada `<input>` desta aba ganha `value`/`onChange` ligados ao estado do Step 1 (ex.: `value={fullName} onChange={(e) => setFullName(e.target.value)}`), na mesma ordem/posição em que já estão: nome completo, e-mail, telefone, endereço. O `CustomSelect` de "Status do Cadastro" é removido desta aba — o backend não aceita `status` na criação (todo funcionário nasce `ACTIVE`).

- [ ] **Step 4: Aba "Cargo & Vínculo"**

O `CustomSelect` de cargo passa a usar `roles` carregado de verdade:

```tsx
                    <CustomSelect
                      value={roleId}
                      onChange={(val) => {
                        setRoleId(val);
                        const role = roles.find(r => r.id === val);
                        if (role) setDepartment(role.department);
                      }}
                      options={roles.map(r => ({ value: r.id, label: `${r.name} (${r.department})` }))}
                      placeholder="Selecione um cargo..."
                    />
```

Adicionar um campo de "Departamento" logo abaixo (editável, pré-preenchido pelo cargo escolhido):

```tsx
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Departamento</label>
                    <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50" />
                  </div>
```

"Data de Admissão" ganha `value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)}`. O `CustomSelect` de "Tipo de Contrato" usa `value={contractType} onChange={(val) => setContractType(val as typeof contractType)}`.

- [ ] **Step 5: Aba "Financeiro"**

"Salário Base" ganha `value={baseValue} onChange={(e) => setBaseValue(e.target.value)} type="number" step="0.01"` (troca o `type="text"` atual). "Dados Bancários" ganha `value={bankDetails} onChange={(e) => setBankDetails(e.target.value)}`. O `CustomSelect` de "Dia de Pagamento" usa `value={paymentDay} onChange={(val) => setPaymentDay(val as typeof paymentDay)}`. O toggle de recorrência usa `checked={salaryRecurrenceEnabled} onChange={(e) => setSalaryRecurrenceEnabled(e.target.checked)}`.

- [ ] **Step 6: Mostrar erro de salvamento e desabilitar o botão durante o envio**

No cabeçalho, o botão "Salvar Registro" ganha `disabled={isSaving}` e mostra `{isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}` seguido de `{isSaving ? 'Salvando...' : 'Salvar Registro'}`. Se `saveError` estiver definido, mostrar um banner de erro logo abaixo do cabeçalho, acima da área de abas.

- [ ] **Step 7: Verificação manual no navegador**

1. Abrir `/app/funcionarios/novo`, preencher todos os campos obrigatórios de todas as abas, com "Recorrência Automática" ligada, e salvar.
2. Confirmar redirecionamento para `/app/funcionarios` e que o novo funcionário aparece na lista.
3. Abrir os detalhes do funcionário criado — confirmar que todos os dados batem com o que foi digitado.
4. Verificar (Prisma Studio) que uma `EmployeeRecurringPayment` "Salário" foi criada.
5. Tentar criar outro funcionário com o mesmo CPF — confirmar mensagem de erro, sem navegar.
6. Tentar salvar sem preencher um campo obrigatório — confirmar que não navega (mesma trava de `if` já existente).

- [ ] **Step 8: Commit**

```bash
git add src/pages/app/EmployeeForm.tsx
git commit -m "feat(frontend): connect EmployeeForm to the real Funcionários backend"
```

---

## Task 5: `FinanceAndVacationModal.tsx` — Pagamentos reais

**Files:**
- Modify: `src/components/FinanceAndVacationModal.tsx`

**Interfaces:**
- Consumes: `api.getEmployee`, `api.listEmployeePayments`, `api.payEmployeePayment`, `api.listEmployeeRecurringPayments`, `api.generateEmployeeCharge` (Task 1).
- Consumed by: `EmployeesList.tsx` (Task 3), que agora passa só `employeeId`/`onClose`.

- [ ] **Step 1: Trocar a assinatura do componente e o carregamento de dados**

Substituir toda a seção de imports/interfaces/props do topo do arquivo (linhas 1-36) por:

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, DollarSign, Calendar, Umbrella, AlertCircle, CheckCircle2, Clock, History, Repeat, Zap, Loader2 } from 'lucide-react';
import * as api from '../lib/api';
import type { EmployeeDetail, EmployeePaymentRecord, EmployeeRecurringPaymentRecord } from '../lib/api';

interface FinanceAndVacationModalProps {
  employeeId: string;
  onClose: () => void;
}

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const FinanceAndVacationModal: React.FC<FinanceAndVacationModalProps> = ({ employeeId, onClose }) => {
  const [activeTab, setActiveTab] = useState<'finance' | 'vacation'>('finance');
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [payments, setPayments] = useState<EmployeePaymentRecord[]>([]);
  const [recurringPayments, setRecurringPayments] = useState<EmployeeRecurringPaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadFinance = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [detail, paymentList, recurringList] = await Promise.all([
        api.getEmployee(employeeId),
        api.listEmployeePayments(employeeId),
        api.listEmployeeRecurringPayments(employeeId),
      ]);
      setEmployee(detail);
      setPayments(paymentList);
      setRecurringPayments(recurringList);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os dados financeiros.');
    } finally {
      setIsLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    loadFinance();
  }, [loadFinance]);

  const handleMarkAsPaid = async (paymentId: string) => {
    setBusyId(paymentId);
    setActionError(null);
    try {
      await api.payEmployeePayment(paymentId);
      setPayments(prev => prev.map(p => p.id === paymentId ? { ...p, status: 'paid' } : p));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível marcar como pago.');
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateCharge = async (recurringPaymentId: string) => {
    setBusyId(recurringPaymentId);
    setActionError(null);
    try {
      await api.generateEmployeeCharge(recurringPaymentId);
      setPayments(await api.listEmployeePayments(employeeId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível gerar a fatura deste mês.');
    } finally {
      setBusyId(null);
    }
  };
```

(As funções `getPaymentStatusIcon`/`getPaymentStatusText`/`getPaymentStatusStyle` continuam exatamente como estão, só operando sobre `payment.status` do novo tipo em vez do antigo.)

- [ ] **Step 2: Loading/erro antes de renderizar o conteúdo**

Logo após a abertura da `motion.div` do card principal (depois da barra colorida do topo), adicionar:

```tsx
          {isLoading || !employee ? (
            <div className="p-16 flex items-center justify-center text-muted flex-1">
              {loadError ? loadError : <Loader2 className="animate-spin" size={32} />}
            </div>
          ) : (
            <>
```

E fechar esse `<>` logo antes do fechamento da `motion.div` principal (depois do corpo com as abas). Todo o JSX de cabeçalho/abas/corpo existente (que hoje usa `employee.name`, `employee.role`, etc. vindos de props) passa a ficar dentro desse bloco, usando o `employee` do estado (`employee.fullName` no lugar de `employee.name`; `roleId` não tem nome de cargo disponível aqui — mostrar só o tipo de contrato e admissão, que já é o que a maior parte do cabeçalho usa).

- [ ] **Step 3: Aba Pagamentos usando os dados carregados**

O bloco "Pagamento Recorrente" passa a iterar `recurringPayments.filter(r => r.status === 'active')` (pode haver mais de uma recorrência ativa, ex.: salário + um bônus recorrente) em vez de um único card fixo — para cada uma, mostrar descrição/valor/dia de vencimento e o botão "Gerar Fatura do Mês" agora com `onClick={() => handleGenerateCharge(r.id)}` e `disabled={busyId === r.id}`.

O histórico de pagamentos itera `payments` (em vez de `employee.payments`); "Marcar Pago" chama `handleMarkAsPaid(payment.id)` com `disabled={busyId === payment.id}`.

Se `actionError` estiver definido, mostrar um banner de erro no topo do corpo da aba.

- [ ] **Step 4: Verificação manual no navegador**

1. Clicar num funcionário na listagem (clique simples) — modal abre, carrega pagamentos e recorrências reais.
2. Clicar "Gerar Fatura do Mês" numa recorrência ativa — confirmar que aparece um novo pagamento pendente no histórico.
3. Clicar de novo no mesmo mês — confirmar mensagem de erro (409, "já existe fatura este mês").
4. Marcar um pagamento como pago — confirmar que o status muda na hora.

- [ ] **Step 5: Commit**

```bash
git add src/components/FinanceAndVacationModal.tsx
git commit -m "feat(frontend): connect FinanceAndVacationModal payments tab to the real backend"
```

---

## Task 6: `FinanceAndVacationModal.tsx` — Férias reais + agendamento

**Files:**
- Modify: `src/components/FinanceAndVacationModal.tsx`

**Interfaces:**
- Consumes: `api.getVacationStatus`, `api.simulateVacation`, `api.scheduleVacation`, `api.listVacationSchedules` (Task 1).

- [ ] **Step 1: Adicionar o estado e o carregamento de férias**

No mesmo componente do Task 5, adicionar ao estado:

```tsx
  const [vacationStatus, setVacationStatus] = useState<api.VacationStatus | null>(null);
  const [vacationSchedules, setVacationSchedules] = useState<api.VacationScheduleRecord[]>([]);
  const [vacationUnavailable, setVacationUnavailable] = useState(false);
  const [isSchedulingOpen, setIsSchedulingOpen] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [simulation, setSimulation] = useState<(api.VacationStatus & { sufficientBalance: boolean }) | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
```

E, dentro de `loadFinance` (Task 5, Step 1), adicionar em paralelo — trocar a função por:

```tsx
  const loadFinance = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setVacationUnavailable(false);
    try {
      const [detail, paymentList, recurringList, schedules] = await Promise.all([
        api.getEmployee(employeeId),
        api.listEmployeePayments(employeeId),
        api.listEmployeeRecurringPayments(employeeId),
        api.listVacationSchedules(employeeId),
      ]);
      setEmployee(detail);
      setPayments(paymentList);
      setRecurringPayments(recurringList);
      setVacationSchedules(schedules);

      try {
        setVacationStatus(await api.getVacationStatus(employeeId));
      } catch {
        setVacationUnavailable(true); // vínculo não-CLT (422)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os dados financeiros.');
    } finally {
      setIsLoading(false);
    }
  }, [employeeId]);
```

- [ ] **Step 2: Handlers de simulação e agendamento**

```tsx
  const daysBetween = (start: string, end: string) => {
    if (!start || !end) return 0;
    const diff = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
    return Math.round(diff / 86_400_000) + 1;
  };

  const handleSimulate = async () => {
    if (!scheduleStart || !scheduleEnd) return;
    setIsSimulating(true);
    setActionError(null);
    setSimulation(null);
    try {
      const result = await api.simulateVacation(employeeId, {
        startDate: scheduleStart, endDate: scheduleEnd, daysCount: daysBetween(scheduleStart, scheduleEnd),
      });
      setSimulation(result);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível simular o período.');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleConfirmSchedule = async () => {
    if (!scheduleStart || !scheduleEnd || isScheduling) return;
    setIsScheduling(true);
    setActionError(null);
    try {
      await api.scheduleVacation(employeeId, {
        startDate: scheduleStart, endDate: scheduleEnd, daysCount: daysBetween(scheduleStart, scheduleEnd),
      });
      setVacationSchedules(await api.listVacationSchedules(employeeId));
      setVacationStatus(await api.getVacationStatus(employeeId));
      setIsSchedulingOpen(false);
      setScheduleStart('');
      setScheduleEnd('');
      setSimulation(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível agendar as férias.');
    } finally {
      setIsScheduling(false);
    }
  };
```

- [ ] **Step 3: Trocar a aba Férias para usar dados reais**

A condição `employee.contractType !== 'clt'` que mostra "Férias Indisponíveis" vira `vacationUnavailable`. Os três cards (Admissão/Saldo/Em Aquisição) passam a ler de `vacationStatus` (`vacationStatus.balanceDays`, `vacationStatus.proportionalDays`, etc.) em vez do `vacationData` calculado localmente — a função `calculateVacation()` inteira é removida do componente.

O botão "Agendar Férias" (que hoje chama `onScheduleVacation(10)` fixo) vira `onClick={() => setIsSchedulingOpen(true)}`, `disabled={!vacationStatus?.balanceDays}`.

Adicionar, logo abaixo do bloco dos três cards, o formulário de agendamento (só quando `isSchedulingOpen`):

```tsx
                    {isSchedulingOpen && (
                      <div className="bg-secondary/10 border border-border/40 rounded-2xl p-5 space-y-4">
                        <h4 className="text-sm font-bold text-foreground">Agendar novo período</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1.5">Data de Início</label>
                            <input type="date" value={scheduleStart} onChange={(e) => { setScheduleStart(e.target.value); setSimulation(null); }} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1.5">Data de Fim</label>
                            <input type="date" value={scheduleEnd} onChange={(e) => { setScheduleEnd(e.target.value); setSimulation(null); }} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                        </div>

                        {!simulation ? (
                          <button
                            onClick={handleSimulate}
                            disabled={!scheduleStart || !scheduleEnd || isSimulating}
                            className="text-sm font-bold text-primary hover:bg-primary/10 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                          >
                            {isSimulating ? 'Simulando...' : 'Simular'}
                          </button>
                        ) : (
                          <div className="bg-background border border-border/60 rounded-xl p-4 space-y-2">
                            <p className="text-sm">
                              {daysBetween(scheduleStart, scheduleEnd)} dias · Adicional de 1/3: <strong>{formatCurrency(simulation.oneThirdBonus)}</strong>
                            </p>
                            {!simulation.sufficientBalance && (
                              <p className="text-sm text-red-500 font-medium flex items-center gap-1.5">
                                <AlertCircle size={14} /> Saldo insuficiente para este período.
                              </p>
                            )}
                            <div className="flex gap-3 pt-2">
                              <button onClick={() => setIsSchedulingOpen(false)} className="flex-1 py-2.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm">
                                Cancelar
                              </button>
                              <button
                                onClick={handleConfirmSchedule}
                                disabled={!simulation.sufficientBalance || isScheduling}
                                className="flex-1 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
                              >
                                {isScheduling ? 'Agendando...' : 'Confirmar Agendamento'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
```

O histórico de períodos passa a iterar `vacationSchedules` em vez de `employee.vacation.history`.

- [ ] **Step 4: Verificação manual no navegador**

1. Abrir o modal financeiro de um funcionário CLT — aba Férias mostra saldo real vindo do backend.
2. Abrir o modal de um funcionário PJ/Estágio — mostra "Férias Indisponíveis".
3. Clicar "Agendar Férias", escolher um período de 1-2 dias, simular — confirmar que mostra o valor do adicional de 1/3.
4. Confirmar o agendamento — confirmar que aparece no histórico e o saldo é reduzido numa nova consulta.
5. Tentar agendar um período que se sobrepõe ao que acabou de ser criado — confirmar mensagem de erro.
6. Tentar agendar mais dias do que o saldo disponível — confirmar que o botão "Confirmar" fica desabilitado com o aviso de saldo insuficiente.

- [ ] **Step 5: Commit**

```bash
git add src/components/FinanceAndVacationModal.tsx
git commit -m "feat(frontend): connect FinanceAndVacationModal vacation tab to the real backend, add scheduling UI"
```

---

## Task 7: Validação final + documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify: `B:\Quickflow\Quickflow\Roles.md`, `EmployeesList.md`, `EmployeeForm.md`

- [ ] **Step 1: Build e lint do frontend**

Run: `cd /c/Users/cadus/Desktop/product && npm run build && npm run lint`
Expected: build limpo, lint sem warnings (`--max-warnings 0`).

- [ ] **Step 2: Percurso completo manual no navegador**

Com backend e frontend rodando, repetir em sequência os roteiros de verificação das Tasks 2-6 (Cargos → Funcionários → Cadastro → Pagamentos → Férias), desta vez de ponta a ponta com o mesmo funcionário, incluindo recarregar a página entre passos para confirmar que tudo persiste de verdade.

- [ ] **Step 3: Atualizar `CLAUDE.md`**

Remover/ajustar a frase que hoje diz "Frontend de RH continua 100% mockado... não foram tocados nem integrados a este backend" (seção de RH) — descrever que a integração foi concluída e apontar rapidamente o padrão usado (mesmo de Clientes).

- [ ] **Step 4: Atualizar as notas do vault**

Usar as skills `obsidian-markdown`/`obsidian-cli`:
- `Roles.md`: atualizar "Observações" removendo a nota de mock, descrevendo a integração real e a mudança de exclusão física para inativação.
- `EmployeesList.md`: mesma atualização, incluindo a mudança do cargo de texto livre para FK real.
- `EmployeeForm.md`: remover a observação "nenhum dado é de fato salvo".

- [ ] **Step 5: Commit final da documentação**

```bash
git add CLAUDE.md
git commit -m "docs: document HR frontend integration"
```
