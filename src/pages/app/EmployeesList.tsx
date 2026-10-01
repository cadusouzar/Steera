import React, { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Ban, ChevronRight, Pencil, Plus, RotateCcw, Search, Wallet, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';
import FinanceAndVacationModal from '../../components/FinanceAndVacationModal';
import OwnDataNote from '../../components/OwnDataNote';
import {
  Button, ButtonLink, ConfirmDialog, Drawer, EmptyState, Field, Input, Modal, Notice, PageHeader,
  SegmentedControl, Select, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea,
} from '../../components/ui';
import * as api from '../../lib/api';
import { can, permissionScope, useCurrentUser } from '../../lib/auth';
import { isOwnDataLocked } from '../../lib/grantCoverage';
import type { EmployeeDetail, EmployeeListItem, EmployeeWarning, Role } from '../../lib/api';
import { formatCpfInput, formatPhoneInput, isValidCpf, isValidEmail, isValidPhone } from '../../lib/validation';

// Funcionários (redesenho monocromático, etapa 2 do polimento — 01/10/2026): tudo no kit de peças.
// Mudanças de comportamento aprovadas pelo usuário: um clique na linha abre a FICHA (antes abria
// Pagamentos e Férias, e a ficha exigia duplo clique); "Pagamentos e férias" virou botão explícito na
// linha e na ficha; o "Filtros" sem ação virou o seletor Todos/Ativos/Inativos; inativar pede
// confirmação; seleções usam o Select nativo do kit.

interface Employee extends EmployeeDetail {
  warnings: EmployeeWarning[];
}

type StatusFilter = 'all' | 'active' | 'inactive';

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

// Formata uma data-only string (ex.: "2026-09-01" ou "2026-09-01T00:00:00.000Z") sem passar por
// `Date`/`toLocaleDateString`, que converteriam para o fuso local e podem exibir o dia anterior em
// fusos com offset negativo (ex.: Brasil, UTC-3).
const formatDateOnly = (dateStr: string) => {
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
};

const CONTRACT_LABEL: Record<EmployeeDetail['contractType'], string> = { clt: 'CLT', pj: 'PJ', estagio: 'Estágio' };
const PAYMENT_DAY_LABEL: Record<EmployeeDetail['paymentDay'], string> = {
  '5': '5º dia útil', '15': 'Dia 15', '20': 'Dia 20', last: 'Último dia útil',
};

// Bloco "rótulo: valor" da ficha em modo leitura.
const InfoList = ({ items }: { items: Array<[string, ReactNode]> }) => (
  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
    {items.map(([label, value]) => (
      <div key={label} className="min-w-0">
        <dt className="text-[12px] text-muted">{label}</dt>
        <dd className="mt-0.5 text-[14px] text-foreground break-words">{value || <span className="text-muted">Não informado</span>}</dd>
      </div>
    ))}
  </dl>
);

const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="py-5 first:pt-0 border-b border-border last:border-0">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const EmployeesList = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Permissões por ação (27/09/2026): cada botão de escrita some sem a permissão da área
  // (funcionarios.gerenciar pra novo/editar/inativar/reativar, advertencias.gerenciar pra registrar
  // advertência). Alcance restrito (PROPRIO/EQUIPE/DEPARTAMENTO) sem ficha vinculada devolve lista
  // vazia do backend; a tela explica o motivo em vez de "nenhum resultado".
  const currentUser = useCurrentUser();
  const canManageEmployees = can('funcionarios.gerenciar', currentUser);
  const canManageWarnings = can('advertencias.gerenciar', currentUser);
  const viewScope = permissionScope('funcionarios.ver', currentUser);
  const isRestrictedWithoutRecord = !!viewScope && viewScope !== 'EMPRESA' && !currentUser?.employeeId;

  const [employeeItems, setEmployeeItems] = useState<EmployeeListItem[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  // Cargos vêm de GET /roles/active, que exige `cargos.ver`; sem ela a lista de funcionários
  // continua funcionando, só sem o nome do cargo.
  const [rolesUnavailable, setRolesUnavailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recurrenceWarning, setRecurrenceWarning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Ficha (gaveta)
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isDrawerLoading, setIsDrawerLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // A própria ficha só pode ser alterada (editar, inativar, reativar, advertências) com
  // "Pode alterar os próprios dados?" no perfil; sem ela o backend recusa com 403.
  const isOwnLocked = isOwnDataLocked(currentUser, selectedEmployee?.id);
  const canEditSelected = canManageEmployees && !isOwnLocked;
  const canWarnSelected = canManageWarnings && !isOwnLocked;

  const [financeEmployeeId, setFinanceEmployeeId] = useState<string | null>(null);

  // Edição
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});
  const [editCpfError, setEditCpfError] = useState<string>();
  const [editEmailError, setEditEmailError] = useState<string>();
  const [editPhoneError, setEditPhoneError] = useState<string>();

  // Advertência e inativação
  const [warningModalOpen, setWarningModalOpen] = useState(false);
  const [warningDate, setWarningDate] = useState('');
  const [warningReason, setWarningReason] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const roleNameById = useCallback(
    (roleId: string) => (rolesUnavailable ? 'Cargo não disponível' : roles.find((r) => r.id === roleId)?.name ?? '(cargo inativo)'),
    [roles, rolesUnavailable],
  );

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [items, activeRoles] = await Promise.all([api.listEmployees(), api.listActiveRoles().catch(() => null)]);
      setEmployeeItems(items);
      setRoles(activeRoles ?? []);
      setRolesUnavailable(activeRoles === null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os funcionários.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Aviso vindo do EmployeeForm quando o funcionário foi criado mas a recorrência de salário não
  // pôde ser configurada — mostrado uma única vez e limpo do history state para não reaparecer.
  useEffect(() => {
    const state = location.state as { recurrenceWarning?: boolean } | null;
    if (state?.recurrenceWarning) {
      setRecurrenceWarning(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  const openEmployeeDetail = async (id: string) => {
    setDrawerId(id);
    setSelectedEmployee(null);
    setIsEditing(false);
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

  const closeDrawer = () => {
    setDrawerId(null);
    setIsEditing(false);
    setActionError(null);
  };

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return employeeItems.filter((emp) => {
      if (statusFilter !== 'all' && emp.status !== statusFilter) return false;
      if (!q) return true;
      return emp.fullName.toLowerCase().includes(q) || roleNameById(emp.roleId).toLowerCase().includes(q) || emp.department.toLowerCase().includes(q);
    });
  }, [employeeItems, searchQuery, statusFilter, roleNameById]);

  const counts = useMemo(() => ({
    all: employeeItems.length,
    active: employeeItems.filter((e) => e.status === 'active').length,
    inactive: employeeItems.filter((e) => e.status === 'inactive').length,
  }), [employeeItems]);

  const handleEditClick = () => {
    setEditForm(selectedEmployee!);
    setEditCpfError(undefined);
    setEditEmailError(undefined);
    setEditPhoneError(undefined);
    setActionError(null);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedEmployee || !editForm.fullName || !editForm.cpf || !editForm.roleId || isSaving) return;

    const cpfErr = !isValidCpf(editForm.cpf) ? 'CPF inválido' : undefined;
    const emailErr = editForm.email && !isValidEmail(editForm.email) ? 'E-mail inválido' : undefined;
    const phoneErr = editForm.phone && !isValidPhone(editForm.phone) ? 'Telefone deve ter DDD + 8 ou 9 dígitos' : undefined;
    setEditCpfError(cpfErr);
    setEditEmailError(emailErr);
    setEditPhoneError(phoneErr);
    if (cpfErr || emailErr || phoneErr) {
      setActionError('Corrija os campos destacados antes de salvar.');
      return;
    }

    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.updateEmployee(selectedEmployee.id, {
        fullName: editForm.fullName, cpf: editForm.cpf, roleId: editForm.roleId,
        managerId: editForm.managerId,
        email: editForm.email, phone: editForm.phone, address: editForm.address,
        department: editForm.department, contractType: editForm.contractType,
        admissionDate: editForm.admissionDate, baseValue: editForm.baseValue,
        paymentDay: editForm.paymentDay, bankDetails: editForm.bankDetails,
        salaryRecurrenceEnabled: editForm.salaryRecurrenceEnabled,
        customFields: editForm.customFields,
      });

      // Ligar/desligar a recorrência automática de salário nesta edição.
      if (editForm.salaryRecurrenceEnabled !== selectedEmployee.salaryRecurrenceEnabled) {
        const recurrences = await api.listEmployeeRecurringPayments(selectedEmployee.id);
        const salaryRecurrence = recurrences.filter((r) => r.description === 'Salário').pop();
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
      setEmployeeItems((prev) => prev.map((e) => (e.id === updated.id
        ? { id: updated.id, fullName: updated.fullName, roleId: updated.roleId, managerId: updated.managerId, department: updated.department, contractType: updated.contractType, status: updated.status, cpfMasked: e.cpfMasked, baseValue: updated.baseValue }
        : e)));
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
      // Só a situação muda: a resposta de inativar/reativar vem sem `managerName` e sem campos
      // personalizados (ver employee-response.mapper.ts) — mesclar o objeto inteiro apagava os dois da tela.
      setSelectedEmployee((prev) => (prev ? { ...prev, status: updated.status, terminationDate: updated.terminationDate } : prev));
      setEmployeeItems((prev) => prev.map((e) => (e.id === updated.id ? { ...e, status: updated.status } : e)));
      setConfirmDeactivate(false);
    } catch (err) {
      setConfirmDeactivate(false);
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
      // Só a situação muda: a resposta de inativar/reativar vem sem `managerName` e sem campos
      // personalizados (ver employee-response.mapper.ts) — mesclar o objeto inteiro apagava os dois da tela.
      setSelectedEmployee((prev) => (prev ? { ...prev, status: updated.status, terminationDate: updated.terminationDate } : prev));
      setEmployeeItems((prev) => prev.map((e) => (e.id === updated.id ? { ...e, status: updated.status } : e)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível reativar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };

  const openWarning = () => {
    setWarningDate(new Date().toISOString().split('T')[0]);
    setWarningReason('');
    setActionError(null);
    setWarningModalOpen(true);
  };

  const handleAddWarning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !warningDate || !warningReason.trim() || isSaving) return;
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

  const setField = <K extends keyof Employee>(key: K, value: Employee[K]) => setEditForm((f) => ({ ...f, [key]: value }));

  // ---------- conteúdo da ficha ----------

  const drawerTitle = selectedEmployee?.fullName ?? (isDrawerLoading ? 'Carregando…' : 'Funcionário');
  const drawerDescription = selectedEmployee
    ? [roleNameById(selectedEmployee.roleId), selectedEmployee.managerName ? `Superior: ${selectedEmployee.managerName}` : null].filter(Boolean).join(' · ')
    : undefined;

  const drawerFooter = !selectedEmployee ? undefined : isEditing ? (
    <>
      <Button variant="secondary" onClick={() => setIsEditing(false)} disabled={isSaving}>Cancelar</Button>
      <Button onClick={handleSaveEdit} loading={isSaving}>Salvar alterações</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" icon={Wallet} onClick={() => setFinanceEmployeeId(selectedEmployee.id)}>Pagamentos e férias</Button>
      {canEditSelected && <Button icon={Pencil} onClick={handleEditClick}>Editar</Button>}
    </>
  );

  const viewBody = selectedEmployee && (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
        <div className="flex items-center gap-2 text-[14px] text-foreground">
          Vínculo
          <StatusBadge tone={selectedEmployee.status === 'active' ? 'success' : 'neutral'}>
            {selectedEmployee.status === 'active' ? 'Ativo' : 'Inativo'}
          </StatusBadge>
        </div>
        {!canManageEmployees ? null : isOwnLocked ? (
          <OwnDataNote />
        ) : selectedEmployee.status === 'active' ? (
          <Button variant="ghost" size="sm" icon={Ban} onClick={() => setConfirmDeactivate(true)} disabled={isSaving}>Inativar</Button>
        ) : (
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={handleReactivateEmployee} loading={isSaving}>Reativar</Button>
        )}
      </div>

      <Section title="Dados pessoais">
        <InfoList items={[
          ['CPF', selectedEmployee.cpf],
          ['E-mail', selectedEmployee.email],
          ['Telefone / WhatsApp', selectedEmployee.phone],
          ['Endereço', selectedEmployee.address],
        ]} />
      </Section>
      <Section title="Cargo e vínculo">
        <InfoList items={[
          ['Departamento', selectedEmployee.department],
          ['Tipo de contrato', CONTRACT_LABEL[selectedEmployee.contractType]],
          ['Admissão', formatDateOnly(selectedEmployee.admissionDate)],
          ['Superior', selectedEmployee.managerName],
        ]} />
      </Section>
      <Section title="Financeiro">
        <InfoList items={[
          ['Salário base', <span className="tabular">{formatCurrency(selectedEmployee.baseValue)}</span>],
          ['Dia de pagamento', PAYMENT_DAY_LABEL[selectedEmployee.paymentDay]],
          ['Dados bancários', selectedEmployee.bankDetails],
          ['Recorrência automática do salário', selectedEmployee.salaryRecurrenceEnabled ? 'Ativada (mensal)' : 'Desativada'],
        ]} />
      </Section>
      <Section
        title="Advertências"
        action={canWarnSelected
          ? <Button variant="secondary" size="sm" icon={Plus} onClick={openWarning}>Registrar</Button>
          : canManageWarnings && isOwnLocked && !canManageEmployees ? <OwnDataNote /> : undefined}
      >
        {selectedEmployee.warnings.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {[...selectedEmployee.warnings].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((w) => (
              <li key={w.id} className="px-4 py-3">
                <p className="text-[12px] text-muted tabular">{formatDateOnly(w.occurredAt)}</p>
                <p className="mt-0.5 text-[14px] text-foreground whitespace-pre-line">{w.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">Nenhuma advertência registrada.</p>
        )}
      </Section>
    </>
  );

  const editBody = selectedEmployee && (
    <div className="space-y-6">
      <Section title="Dados pessoais">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome completo" htmlFor="ed-name" required className="sm:col-span-2">
            <Input id="ed-name" value={editForm.fullName || ''} onChange={(e) => setField('fullName', e.target.value)} />
          </Field>
          <Field label="CPF" htmlFor="ed-cpf" required error={editCpfError}>
            <Input
              id="ed-cpf" value={editForm.cpf || ''} maxLength={14} invalid={!!editCpfError}
              onChange={(e) => setField('cpf', formatCpfInput(e.target.value))}
              onBlur={() => setEditCpfError(editForm.cpf && !isValidCpf(editForm.cpf) ? 'CPF inválido' : undefined)}
            />
          </Field>
          <Field label="E-mail" htmlFor="ed-email" error={editEmailError}>
            <Input
              id="ed-email" type="email" value={editForm.email || ''} invalid={!!editEmailError}
              onChange={(e) => setField('email', e.target.value)}
              onBlur={() => setEditEmailError(editForm.email && !isValidEmail(editForm.email) ? 'E-mail inválido' : undefined)}
            />
          </Field>
          <Field label="Telefone / WhatsApp" htmlFor="ed-phone" error={editPhoneError}>
            <Input
              id="ed-phone" value={editForm.phone || ''} maxLength={15} invalid={!!editPhoneError}
              onChange={(e) => setField('phone', formatPhoneInput(e.target.value))}
              onBlur={() => setEditPhoneError(editForm.phone && !isValidPhone(editForm.phone) ? 'Telefone deve ter DDD + 8 ou 9 dígitos' : undefined)}
            />
          </Field>
          <Field label="Endereço" htmlFor="ed-address">
            <Input id="ed-address" value={editForm.address || ''} onChange={(e) => setField('address', e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Cargo e vínculo">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Cargo" htmlFor="ed-role" required>
            <Select
              id="ed-role" value={editForm.roleId || ''}
              onChange={(e) => {
                const role = roles.find((r) => r.id === e.target.value);
                setEditForm((f) => ({ ...f, roleId: e.target.value, department: role?.department ?? f.department }));
              }}
            >
              {!roles.some((r) => r.id === editForm.roleId) && <option value={editForm.roleId}>{roleNameById(editForm.roleId || '')}</option>}
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.department})</option>)}
            </Select>
          </Field>
          <Field label="Departamento" htmlFor="ed-dept">
            <Input id="ed-dept" value={editForm.department || ''} onChange={(e) => setField('department', e.target.value)} />
          </Field>
          <Field label="Superior" htmlFor="ed-manager" className="sm:col-span-2" hint="Quem administra o ponto deste funcionário (aprova ou rejeita ajustes e corrige marcações).">
            <Select id="ed-manager" value={editForm.managerId || ''} onChange={(e) => setField('managerId', e.target.value || null)}>
              <option value="">Nenhum (sem superior)</option>
              {employeeItems.filter((e) => e.id !== selectedEmployee.id).map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
            </Select>
          </Field>
          <Field label="Data de admissão" htmlFor="ed-admission">
            <Input id="ed-admission" type="date" value={editForm.admissionDate?.slice(0, 10) || ''} onChange={(e) => setField('admissionDate', e.target.value)} />
          </Field>
          <Field label="Tipo de contrato" htmlFor="ed-contract">
            <Select id="ed-contract" value={editForm.contractType || 'clt'} onChange={(e) => setField('contractType', e.target.value as Employee['contractType'])}>
              <option value="clt">CLT</option>
              <option value="pj">PJ</option>
              <option value="estagio">Estágio</option>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Financeiro">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Salário base" htmlFor="ed-salary">
            <Input id="ed-salary" type="number" min={0} step="0.01" value={editForm.baseValue ?? ''} onChange={(e) => setField('baseValue', Number(e.target.value))} placeholder="0,00" />
          </Field>
          <Field label="Dia de pagamento" htmlFor="ed-payday">
            <Select id="ed-payday" value={editForm.paymentDay || '5'} onChange={(e) => setField('paymentDay', e.target.value as Employee['paymentDay'])}>
              <option value="5">5º dia útil</option>
              <option value="15">Dia 15</option>
              <option value="20">Dia 20</option>
              <option value="last">Último dia útil</option>
            </Select>
          </Field>
          <Field label="Dados bancários" htmlFor="ed-bank" hint="Opcional: banco, agência, conta ou PIX.">
            <Input id="ed-bank" value={editForm.bankDetails || ''} onChange={(e) => setField('bankDetails', e.target.value)} />
          </Field>
          <Field label="Recorrência automática do salário" htmlFor="ed-recurrence">
            <Select id="ed-recurrence" value={editForm.salaryRecurrenceEnabled ? 'yes' : 'no'} onChange={(e) => setField('salaryRecurrenceEnabled', e.target.value === 'yes')}>
              <option value="yes">Sim, gerar o pagamento todo mês</option>
              <option value="no">Não</option>
            </Select>
          </Field>
        </div>
        <CustomFieldsFormSection entity="employee" values={editForm.customFields ?? {}} onChange={(v) => setField('customFields', v)} />
      </Section>
    </div>
  );

  // ---------- página ----------

  const emptyState = employeeItems.length === 0 && isRestrictedWithoutRecord ? (
    <EmptyState
      title="Nenhuma ficha vinculada"
      description="Seu acesso está ligado aos seus próprios dados, mas seu login ainda não tem uma ficha de funcionário. Peça a quem administra os acessos para vincular."
    />
  ) : employeeItems.length === 0 ? (
    <EmptyState
      title="Nenhum funcionário ainda"
      description="Cadastre o primeiro funcionário para controlar ponto, férias e pagamentos."
      action={canManageEmployees ? <ButtonLink to="/app/funcionarios/novo" icon={Plus}>Novo funcionário</ButtonLink> : undefined}
    />
  ) : (
    <EmptyState
      title="Nenhum funcionário encontrado"
      description={searchQuery ? `Nada corresponde a “${searchQuery}” neste filtro.` : 'Nenhum funcionário neste filtro.'}
      action={<Button variant="secondary" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>Limpar busca e filtro</Button>}
    />
  );

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Funcionários"
          description="Gerencie a base de pessoas da sua empresa."
          actions={canManageEmployees ? <ButtonLink to="/app/funcionarios/novo" icon={Plus}>Novo funcionário</ButtonLink> : undefined}
        />

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome, cargo ou departamento"
              aria-label="Buscar funcionários"
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-secondary"
                aria-label="Limpar busca"
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            )}
          </div>
          <SegmentedControl<StatusFilter>
            label="Filtrar por situação"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: `Todos ${counts.all}` },
              { value: 'active', label: `Ativos ${counts.active}` },
              { value: 'inactive', label: `Inativos ${counts.inactive}` },
            ]}
          />
        </div>

        {loadError && <Notice tone="danger" className="mb-4">{loadError}</Notice>}
        {recurrenceWarning && (
          <Notice tone="warning" className="mb-4" onDismiss={() => setRecurrenceWarning(false)}>
            Funcionário criado, mas não foi possível configurar a recorrência automática do salário. Configure em Pagamentos e férias.
          </Notice>
        )}

        <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border" aria-label="Carregando funcionários" role="status">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-6 px-5 h-14">
                  <span className="skeleton h-4 w-44" />
                  <span className="skeleton h-4 w-24" />
                  <span className="skeleton h-4 w-24 hidden sm:block" />
                  <span className="skeleton h-4 w-20 ml-auto" />
                </div>
              ))}
            </div>
          ) : filteredEmployees.length > 0 ? (
            <Table>
              <THead>
                <tr>
                  <TH>Nome</TH>
                  <TH className="hidden sm:table-cell">Cargo</TH>
                  <TH className="hidden lg:table-cell">Departamento</TH>
                  <TH align="right" className="hidden md:table-cell">Salário</TH>
                  <TH>Situação</TH>
                  <TH align="right"><span className="sr-only">Ações</span></TH>
                </tr>
              </THead>
              <TBody>
                {filteredEmployees.map((emp) => (
                  <TR key={emp.id} interactive onClick={() => openEmployeeDetail(emp.id)}>
                    <TD>
                      {/* Botão real com o nome: dá acesso por teclado à ficha (a linha inteira é só atalho de mouse). */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openEmployeeDetail(emp.id); }}
                        className="font-medium text-foreground text-left hover:underline underline-offset-4 outline-none focus-visible:underline"
                      >
                        {emp.fullName}
                      </button>
                      {/* No celular o cargo vem embaixo do nome (a coluna própria some). */}
                      <span className="block text-[12px] text-muted sm:hidden">{roleNameById(emp.roleId)}</span>
                    </TD>
                    <TD className="text-muted hidden sm:table-cell">{roleNameById(emp.roleId)}</TD>
                    <TD className="text-muted hidden lg:table-cell">{emp.department}</TD>
                    <TD align="right" className="tabular hidden md:table-cell">{formatCurrency(emp.baseValue)}</TD>
                    <TD>
                      <StatusBadge tone={emp.status === 'active' ? 'success' : 'neutral'}>{emp.status === 'active' ? 'Ativo' : 'Inativo'}</StatusBadge>
                    </TD>
                    <TD align="right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost" size="sm" icon={Wallet}
                          onClick={(e) => { e.stopPropagation(); setFinanceEmployeeId(emp.id); }}
                          aria-label={`Pagamentos e férias de ${emp.fullName}`}
                        >
                          <span className="hidden lg:inline">Pagamentos e férias</span>
                        </Button>
                        <ChevronRight size={16} strokeWidth={1.6} className="text-muted" aria-hidden="true" />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            emptyState
          )}
        </div>
      </div>

      {/* Ficha */}
      <Drawer
        open={drawerId !== null}
        onClose={closeDrawer}
        title={drawerTitle}
        description={drawerDescription}
        size="lg"
        dismissable={!isSaving}
        footer={drawerFooter}
      >
        {actionError && <Notice tone="danger" className="mb-5">{actionError}</Notice>}
        {isDrawerLoading && (
          <div className="space-y-6" role="status" aria-label="Carregando ficha">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-3">
                <span className="skeleton block h-4 w-32" />
                <div className="grid grid-cols-2 gap-4">
                  <span className="skeleton h-9" />
                  <span className="skeleton h-9" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!isDrawerLoading && (isEditing ? editBody : viewBody)}
      </Drawer>

      {/* Inativar */}
      <ConfirmDialog
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={handleDeactivateEmployee}
        busy={isSaving}
        tone="danger"
        title={`Inativar ${selectedEmployee?.fullName ?? 'funcionário'}?`}
        description="Ele deixa de aparecer como ativo e de gerar o salário automático. O histórico de pagamentos, férias e advertências fica guardado, e você pode reativar depois."
        confirmLabel="Inativar"
      />

      {/* Nova advertência */}
      <Modal
        open={warningModalOpen && !!selectedEmployee}
        onClose={() => setWarningModalOpen(false)}
        title="Registrar advertência"
        description={selectedEmployee ? `${selectedEmployee.fullName} · ${roleNameById(selectedEmployee.roleId)}` : undefined}
        size="sm"
        dismissable={!isSaving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setWarningModalOpen(false)} disabled={isSaving}>Cancelar</Button>
            <Button type="submit" form="warning-form" loading={isSaving} disabled={!warningDate || !warningReason.trim()}>Registrar</Button>
          </>
        }
      >
        <form id="warning-form" onSubmit={handleAddWarning} className="space-y-4">
          {actionError && <Notice tone="danger">{actionError}</Notice>}
          <Field label="Data da ocorrência" htmlFor="w-date" required>
            <Input id="w-date" type="date" required value={warningDate} onChange={(e) => setWarningDate(e.target.value)} />
          </Field>
          <Field label="Motivo" htmlFor="w-reason" required>
            <Textarea id="w-reason" required value={warningReason} onChange={(e) => setWarningReason(e.target.value)} placeholder="Descreva o que aconteceu de forma clara e objetiva." />
          </Field>
        </form>
      </Modal>

      <FinanceAndVacationModal employeeId={financeEmployeeId} onClose={() => setFinanceEmployeeId(null)} />
    </div>
  );
};

export default EmployeesList;
