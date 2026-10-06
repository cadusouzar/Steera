import React, { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Ban, CalendarPlus, Plane, Briefcase, RotateCcw, Trash2, Undo2, Wallet, Zap } from 'lucide-react';
import * as api from '../lib/api';
import { useCan, useCurrentUser } from '../lib/auth';
import { isOwnDataLocked } from '../lib/grantCoverage';
import OwnDataNote from './OwnDataNote';
import { ApiError } from '../lib/apiError';
import type { EmployeeDetail, EmployeePaymentRecord, EmployeeRecurringPaymentRecord } from '../lib/api';
import { reloadAfterSave } from '../lib/reloadAfterSave';
import { Button, ConfirmDialog, Field, Input, Modal, Notice, StatusBadge, Tabs, toast, type StatusTone } from './ui';

// Pagamentos, férias e afastamento de um funcionário (redesenho no kit de peças, 01/10/2026). Fica
// montado pela lista e abre/fecha pelo `employeeId` (null = fechado) — assim a janela anima também
// ao fechar. Toda a lógica (teto de 30 dias com exceção autorizada, "Retomar", recarregar depois de
// desfazer pagamento) é a mesma de antes; só a apresentação mudou.

interface FinanceAndVacationModalProps {
  employeeId: string | null;
  onClose: () => void;
}

type Tab = 'finance' | 'vacation' | 'leave';

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

// Formata uma data-only string sem passar por `Date` (que converteria para o fuso local e poderia
// exibir o dia anterior em fusos com offset negativo, ex.: Brasil, UTC-3).
const formatDateOnly = (dateStr: string) => {
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
};

// O alcance de `pagamentos.gerenciar` pode ser menor que o de `funcionarios.ver` (ex.: vê a empresa
// toda, mas só cuida dos pagamentos da equipe). Fora desse alcance o backend responde 404 nas listas
// de pagamento; isso vira lista vazia, pra férias e afastamentos continuarem carregando.
const emptyWhenOutOfScope = <T,>(promise: Promise<T[]>): Promise<T[]> =>
  promise.catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) return [] as T[];
    throw err;
  });

const PAYMENT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  paid: { label: 'Pago', tone: 'success' },
  overdue: { label: 'Atrasado', tone: 'danger' },
  pending: { label: 'Pendente', tone: 'warning' },
};

const SCHEDULE_STATUS: Record<api.VacationScheduleRecord['status'], { label: string; tone: StatusTone }> = {
  scheduled: { label: 'Agendado', tone: 'neutral' },
  approved: { label: 'Aprovado', tone: 'neutral' },
  in_progress: { label: 'Em andamento', tone: 'warning' },
  completed: { label: 'Concluído', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
};

const daysBetween = (start: string, end: string) => {
  if (!start || !end) return 0;
  const diff = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.round(diff / 86_400_000) + 1;
};

const SectionTitle = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="mb-3 flex items-center justify-between gap-3">
    <h3 className="text-[14px] font-semibold text-foreground">{children}</h3>
    {action}
  </div>
);

const ListBox = ({ children }: { children: ReactNode }) => (
  <ul className="divide-y divide-border rounded-md border border-border">{children}</ul>
);

const EmptyLine = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[14px] text-muted">{children}</p>
);

const FinanceAndVacationModal: React.FC<FinanceAndVacationModalProps> = ({ employeeId, onClose }) => {
  // Permissões por ação (27/09/2026): pagamentos (ler e escrever) exigem `pagamentos.gerenciar`,
  // então sem ela a aba Pagamentos nem aparece e nada de pagamento é buscado; agendar/cancelar/
  // retomar férias e afastamentos exige `ferias.gerenciar` (o histórico continua visível).
  const can = useCan();
  const canManagePayments = can('pagamentos.gerenciar');
  const canManageVacations = can('ferias.gerenciar');

  // Mantém o último funcionário enquanto a janela anima a saída.
  const [shownId, setShownId] = useState<string | null>(employeeId);
  useEffect(() => { if (employeeId) setShownId(employeeId); }, [employeeId]);

  // Na própria ficha, escrever (pagamentos, recorrências, férias, afastamentos) também exige
  // "Pode alterar os próprios dados?" no perfil; sem ela o backend recusa com 403. Ler continua livre.
  const currentUser = useCurrentUser();
  const isOwnLocked = isOwnDataLocked(currentUser, shownId ?? undefined);
  const canWritePayments = canManagePayments && !isOwnLocked;
  const canWriteVacations = canManageVacations && !isOwnLocked;

  const [activeTab, setActiveTab] = useState<Tab>(canManagePayments ? 'finance' : 'vacation');
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [payments, setPayments] = useState<EmployeePaymentRecord[]>([]);
  const [recurringPayments, setRecurringPayments] = useState<EmployeeRecurringPaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [vacationSchedules, setVacationSchedules] = useState<api.VacationScheduleRecord[]>([]);
  const [isSchedulingOpen, setIsSchedulingOpen] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [exceptionAuthorized, setExceptionAuthorized] = useState(false);
  const [resumeCapErrorId, setResumeCapErrorId] = useState<string | null>(null);
  const [resumeExceptionAuthorized, setResumeExceptionAuthorized] = useState(false);
  const [leaveSchedules, setLeaveSchedules] = useState<api.LeaveScheduleRecord[]>([]);
  const [isLeaveSchedulingOpen, setIsLeaveSchedulingOpen] = useState(false);
  const [leaveScheduleStart, setLeaveScheduleStart] = useState('');
  const [leaveScheduleEnd, setLeaveScheduleEnd] = useState('');
  const [leaveReason, setLeaveReason] = useState('');
  const [isSchedulingLeave, setIsSchedulingLeave] = useState(false);

  const loadFinance = useCallback(async (id: string) => {
    setIsLoading(true);
    setLoadError(null);
    setEmployee(null);
    try {
      const [detail, paymentList, recurringList, schedules, leaveList] = await Promise.all([
        api.getEmployee(id),
        canManagePayments ? emptyWhenOutOfScope(api.listEmployeePayments(id)) : Promise.resolve([] as EmployeePaymentRecord[]),
        canManagePayments ? emptyWhenOutOfScope(api.listEmployeeRecurringPayments(id)) : Promise.resolve([] as EmployeeRecurringPaymentRecord[]),
        api.listVacationSchedules(id),
        api.listLeaveSchedules(id),
      ]);
      setEmployee(detail);
      setPayments(paymentList);
      setRecurringPayments(recurringList);
      setVacationSchedules(schedules);
      setLeaveSchedules(leaveList);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os dados financeiros.');
    } finally {
      setIsLoading(false);
    }
  }, [canManagePayments]);

  // Cada abertura começa limpa: aba padrão, formulários fechados, sem erro de outra pessoa.
  useEffect(() => {
    if (!employeeId) return;
    setActiveTab(canManagePayments ? 'finance' : 'vacation');
    setActionError(null);
    setIsSchedulingOpen(false);
    setIsLeaveSchedulingOpen(false);
    setResumeCapErrorId(null);
    setResumeExceptionAuthorized(false);
    loadFinance(employeeId);
  }, [employeeId, canManagePayments, loadFinance]);

  const id = shownId ?? '';

  const handleMarkAsPaid = async (paymentId: string) => {
    setBusyId(paymentId);
    setActionError(null);
    try {
      await api.payEmployeePayment(paymentId);
      toast.success('Pagamento marcado como pago');
      setPayments((prev) => prev.map((p) => (p.id === paymentId ? { ...p, status: 'paid' } : p)));
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
      toast.success('Pagamento do mês gerado');
      await reloadAfterSave(async () => setPayments(await api.listEmployeePayments(id)), setActionError);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível gerar a fatura deste mês.');
    } finally {
      setBusyId(null);
    }
  };

  // Diferente de marcar como pago, não dá pra assumir o novo status ao desfazer: o status derivado
  // pelo backend pode voltar como 'pending' OU 'overdue' (se `dueDate` já passou) — recarrega a lista.
  const handleUnmarkAsPaid = async (paymentId: string) => {
    setBusyId(paymentId);
    setActionError(null);
    try {
      await api.unpayEmployeePayment(paymentId);
      toast.success('Pagamento voltou para pendente');
      await reloadAfterSave(async () => setPayments(await api.listEmployeePayments(id)), setActionError);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível desfazer o pagamento.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteRecurringPayment = async (recurringPaymentId: string) => {
    setBusyId(recurringPaymentId);
    setActionError(null);
    try {
      await api.deleteEmployeeRecurringPayment(recurringPaymentId);
      toast.success('Recorrência excluída');
      await reloadAfterSave(async () => setRecurringPayments(await api.listEmployeeRecurringPayments(id)), setActionError);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível excluir o pagamento recorrente.');
    } finally {
      setBusyId(null);
      setConfirmingDeleteId(null);
    }
  };

  const handleCancelVacation = async (scheduleId: string) => {
    setBusyId(scheduleId);
    setActionError(null);
    try {
      await api.cancelVacationSchedule(scheduleId);
      toast.success('Férias canceladas');
      await reloadAfterSave(async () => setVacationSchedules(await api.listVacationSchedules(id)), setActionError);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível cancelar as férias.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelLeave = async (scheduleId: string) => {
    setBusyId(scheduleId);
    setActionError(null);
    try {
      await api.cancelLeaveSchedule(scheduleId);
      toast.success('Afastamento cancelado');
      await reloadAfterSave(async () => setLeaveSchedules(await api.listLeaveSchedules(id)), setActionError);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível cancelar o afastamento.');
    } finally {
      setBusyId(null);
    }
  };

  // Mesma UX de "reenviar com exceção" do agendamento: a 1ª tentativa nunca manda
  // exceptionAuthorized; se o backend rejeitar pelo teto de 30 dias, lembramos QUAL linha disparou o
  // erro pra mostrar a confirmação de exceção só ali. Outro tipo de erro limpa esse estado.
  const handleResumeVacation = async (scheduleId: string) => {
    setBusyId(scheduleId);
    setActionError(null);
    try {
      await api.resumeVacationSchedule(scheduleId, resumeCapErrorId === scheduleId ? resumeExceptionAuthorized : undefined);
      toast.success('Férias retomadas');
      await reloadAfterSave(async () => setVacationSchedules(await api.listVacationSchedules(id)), setActionError);
      setResumeCapErrorId(null);
      setResumeExceptionAuthorized(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível retomar as férias.';
      setActionError(message);
      if (message.includes('Limite de 30 dias')) {
        setResumeCapErrorId(scheduleId);
      } else {
        setResumeCapErrorId(null);
        setResumeExceptionAuthorized(false);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleResumeLeave = async (scheduleId: string) => {
    setBusyId(scheduleId);
    setActionError(null);
    try {
      await api.resumeLeaveSchedule(scheduleId);
      toast.success('Afastamento retomado');
      await reloadAfterSave(async () => setLeaveSchedules(await api.listLeaveSchedules(id)), setActionError);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível retomar o afastamento.');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmSchedule = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!scheduleStart || !scheduleEnd || isScheduling) return;
    setIsScheduling(true);
    setActionError(null);
    // Uma nova tentativa de agendamento não herda a exceção de um "Retomar" de outra linha.
    setResumeCapErrorId(null);
    setResumeExceptionAuthorized(false);
    try {
      await api.scheduleVacation(id, {
        startDate: scheduleStart, endDate: scheduleEnd, daysCount: daysBetween(scheduleStart, scheduleEnd), exceptionAuthorized,
      });
      toast.success(`Férias agendadas${employee ? `: ${employee.fullName}` : ''}`);
      await reloadAfterSave(async () => setVacationSchedules(await api.listVacationSchedules(id)), setActionError);
      setIsSchedulingOpen(false);
      setScheduleStart('');
      setScheduleEnd('');
      setExceptionAuthorized(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível agendar as férias.');
    } finally {
      setIsScheduling(false);
    }
  };

  const handleScheduleLeave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!leaveScheduleStart || !leaveScheduleEnd || isSchedulingLeave) return;
    setIsSchedulingLeave(true);
    setActionError(null);
    try {
      await api.scheduleLeave(id, {
        startDate: leaveScheduleStart,
        endDate: leaveScheduleEnd,
        daysCount: daysBetween(leaveScheduleStart, leaveScheduleEnd),
        reason: leaveReason || undefined,
      });
      toast.success(`Afastamento agendado${employee ? `: ${employee.fullName}` : ''}`);
      await reloadAfterSave(async () => setLeaveSchedules(await api.listLeaveSchedules(id)), setActionError);
      setIsLeaveSchedulingOpen(false);
      setLeaveScheduleStart('');
      setLeaveScheduleEnd('');
      setLeaveReason('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível agendar o afastamento.');
    } finally {
      setIsSchedulingLeave(false);
    }
  };

  const vacationUnavailable = employee?.contractType !== 'clt';
  const vacationCapExceeded = !!actionError && actionError.includes('Limite de 30 dias');

  // `actionError` é compartilhado entre as abas — trocar de aba sem limpá-lo deixaria o aviso (e a
  // exceção do teto de 30 dias) vazar de uma aba pra outra. O mesmo vale pro "Retomar" com exceção.
  const handleTabChange = (tab: Tab) => {
    setActionError(null);
    setResumeCapErrorId(null);
    setResumeExceptionAuthorized(false);
    setActiveTab(tab);
  };

  const tabs = [
    ...(canManagePayments ? [{ id: 'finance' as const, label: 'Pagamentos', icon: Wallet }] : []),
    { id: 'vacation' as const, label: 'Férias', icon: Plane },
    { id: 'leave' as const, label: 'Afastamento', icon: Briefcase },
  ];

  const scheduleRow = (
    sched: api.VacationScheduleRecord | api.LeaveScheduleRecord,
    onCancel: (id: string) => void,
    onResume: (id: string) => void,
    extra?: ReactNode,
  ) => (
    <li key={sched.id} className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] text-foreground tabular">{formatDateOnly(sched.startDate)} até {formatDateOnly(sched.endDate)}</p>
          <p className="text-[12px] text-muted">
            {sched.daysCount} {sched.daysCount === 1 ? 'dia' : 'dias'}
            {'reason' in sched && sched.reason ? ` · ${sched.reason}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={SCHEDULE_STATUS[sched.status].tone}>{SCHEDULE_STATUS[sched.status].label}</StatusBadge>
          {canWriteVacations && (sched.status === 'scheduled' || sched.status === 'approved') && (
            <Button variant="ghost" size="sm" icon={Ban} loading={busyId === sched.id} onClick={() => onCancel(sched.id)}>Cancelar</Button>
          )}
          {canWriteVacations && sched.status === 'cancelled' && (
            <Button variant="secondary" size="sm" icon={RotateCcw} loading={busyId === sched.id} onClick={() => onResume(sched.id)}>Retomar</Button>
          )}
        </div>
      </div>
      {extra}
    </li>
  );

  const exceptionCheckbox = (checked: boolean, onChange: (v: boolean) => void, text: string) => (
    <label className="mt-3 flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning/[0.06] px-3 py-2.5 text-[13px] text-foreground cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-foreground" />
      {text}
    </label>
  );

  const financeTab = employee && (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 rounded-md border border-border px-4 py-3">
        <div>
          <dt className="text-[12px] text-muted">Salário base</dt>
          <dd className="mt-0.5 text-[20px] font-semibold tracking-tight text-foreground tabular">{formatCurrency(employee.baseValue)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-muted">Dia de pagamento</dt>
          <dd className="mt-0.5 text-[14px] text-foreground">{employee.paymentDay === 'last' ? 'Último dia útil do mês' : `Todo dia ${employee.paymentDay}`}</dd>
        </div>
      </dl>

      {recurringPayments.some((r) => r.status === 'active') && (
        <div>
          <SectionTitle>Pagamento recorrente</SectionTitle>
          <ListBox>
            {recurringPayments.filter((r) => r.status === 'active').map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] text-foreground">{r.description}</p>
                  <p className="text-[12px] text-muted"><span className="tabular">{formatCurrency(r.amount)}</span> · vence todo dia {r.dueDay}</p>
                </div>
                {canWritePayments && (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" icon={Zap} loading={busyId === r.id} onClick={() => handleGenerateCharge(r.id)}>Gerar fatura do mês</Button>
                    <Button variant="ghost" size="sm" icon={Trash2} disabled={busyId === r.id} onClick={() => setConfirmingDeleteId(r.id)}>Excluir</Button>
                  </div>
                )}
              </li>
            ))}
          </ListBox>
        </div>
      )}

      <div>
        <SectionTitle>Histórico de pagamentos</SectionTitle>
        {payments.length > 0 ? (
          <ListBox>
            {payments.map((payment) => {
              const status = PAYMENT_STATUS[payment.status] ?? PAYMENT_STATUS.pending;
              return (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-foreground">{payment.description}</p>
                    <p className="text-[12px] text-muted tabular">{formatDateOnly(payment.dueDate)} · {formatCurrency(payment.amount)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    {!canWritePayments ? null : payment.status !== 'paid' ? (
                      <Button variant="secondary" size="sm" loading={busyId === payment.id} onClick={() => handleMarkAsPaid(payment.id)}>Marcar como pago</Button>
                    ) : (
                      <Button variant="ghost" size="sm" icon={Undo2} loading={busyId === payment.id} onClick={() => handleUnmarkAsPaid(payment.id)}>Desfazer</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ListBox>
        ) : (
          <EmptyLine>Nenhum pagamento registrado ainda.</EmptyLine>
        )}
      </div>
    </div>
  );

  const vacationTab = employee && (vacationUnavailable ? (
    <div className="rounded-md border border-dashed border-border px-6 py-10 text-center">
      <p className="text-[15px] font-semibold text-foreground">Férias disponíveis só para CLT</p>
      <p className="mt-1 text-[14px] text-muted max-w-md mx-auto">
        Este funcionário tem contrato {employee.contractType === 'pj' ? 'PJ' : 'de estágio'}. A gestão de férias de 30 dias vale apenas para contratos CLT, conforme a legislação trabalhista.
      </p>
    </div>
  ) : (
    <div className="space-y-6">
      {isSchedulingOpen && (
        <form onSubmit={handleConfirmSchedule} className="rounded-md border border-border p-4">
          <p className="mb-3 text-[14px] font-semibold text-foreground">Agendar novo período</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Início" htmlFor="v-start" required><Input id="v-start" type="date" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} /></Field>
            <Field label="Fim" htmlFor="v-end" required hint={scheduleStart && scheduleEnd ? `${daysBetween(scheduleStart, scheduleEnd)} dias` : undefined}>
              <Input id="v-end" type="date" value={scheduleEnd} min={scheduleStart || undefined} onChange={(e) => setScheduleEnd(e.target.value)} />
            </Field>
          </div>
          {vacationCapExceeded && resumeCapErrorId === null && exceptionCheckbox(exceptionAuthorized, setExceptionAuthorized, 'Autorizar exceção e agendar mesmo assim, ultrapassando os 30 dias')}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setIsSchedulingOpen(false); setScheduleStart(''); setScheduleEnd(''); setExceptionAuthorized(false); setActionError(null); }}>Cancelar</Button>
            <Button type="submit" loading={isScheduling} disabled={!scheduleStart || !scheduleEnd}>Agendar férias</Button>
          </div>
        </form>
      )}
      <div>
        <SectionTitle
          action={canWriteVacations && !isSchedulingOpen ? (
            <Button variant="secondary" size="sm" icon={CalendarPlus} onClick={() => { setIsSchedulingOpen(true); setExceptionAuthorized(false); setActionError(null); setResumeCapErrorId(null); setResumeExceptionAuthorized(false); }}>
              Agendar férias
            </Button>
          ) : undefined}
        >
          Histórico de férias
        </SectionTitle>
        {vacationSchedules.length > 0 ? (
          <ListBox>
            {vacationSchedules.map((sched) => scheduleRow(sched, handleCancelVacation, handleResumeVacation,
              resumeCapErrorId === sched.id
                ? exceptionCheckbox(resumeExceptionAuthorized, setResumeExceptionAuthorized, 'Autorizar exceção e retomar mesmo assim, ultrapassando os 30 dias')
                : undefined))}
          </ListBox>
        ) : (
          <EmptyLine>Nenhum período de férias registrado.</EmptyLine>
        )}
      </div>
    </div>
  ));

  const leaveTab = employee && (
    <div className="space-y-6">
      {isLeaveSchedulingOpen && (
        <form onSubmit={handleScheduleLeave} className="rounded-md border border-border p-4">
          <p className="mb-3 text-[14px] font-semibold text-foreground">Agendar afastamento</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Início" htmlFor="l-start" required><Input id="l-start" type="date" value={leaveScheduleStart} onChange={(e) => setLeaveScheduleStart(e.target.value)} /></Field>
            <Field label="Fim" htmlFor="l-end" required hint={leaveScheduleStart && leaveScheduleEnd ? `${daysBetween(leaveScheduleStart, leaveScheduleEnd)} dias` : undefined}>
              <Input id="l-end" type="date" value={leaveScheduleEnd} min={leaveScheduleStart || undefined} onChange={(e) => setLeaveScheduleEnd(e.target.value)} />
            </Field>
            <Field label="Motivo" htmlFor="l-reason" hint="Opcional." className="sm:col-span-2">
              <Input id="l-reason" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Ex.: licença médica" />
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setIsLeaveSchedulingOpen(false); setLeaveScheduleStart(''); setLeaveScheduleEnd(''); setLeaveReason(''); }}>Cancelar</Button>
            <Button type="submit" loading={isSchedulingLeave} disabled={!leaveScheduleStart || !leaveScheduleEnd}>Agendar afastamento</Button>
          </div>
        </form>
      )}
      <div>
        <SectionTitle
          action={canWriteVacations && !isLeaveSchedulingOpen ? (
            <Button variant="secondary" size="sm" icon={CalendarPlus} onClick={() => setIsLeaveSchedulingOpen(true)}>Agendar afastamento</Button>
          ) : undefined}
        >
          Histórico de afastamentos
        </SectionTitle>
        {leaveSchedules.length > 0 ? (
          <ListBox>{leaveSchedules.map((sched) => scheduleRow(sched, handleCancelLeave, handleResumeLeave))}</ListBox>
        ) : (
          <EmptyLine>Nenhum afastamento registrado.</EmptyLine>
        )}
      </div>
    </div>
  );

  const ownNote = (activeTab === 'finance' ? canManagePayments : canManageVacations) && isOwnLocked;
  const confirmingRecurring = recurringPayments.find((r) => r.id === confirmingDeleteId);

  return (
    <>
      <Modal
        open={!!employeeId}
        onClose={onClose}
        size="xl"
        title={employee?.fullName ?? (loadError ? 'Pagamentos e férias' : 'Carregando…')}
        description={employee ? `${employee.contractType === 'clt' ? 'CLT' : employee.contractType === 'pj' ? 'PJ' : 'Estágio'} · admitido em ${formatDateOnly(employee.admissionDate)}` : undefined}
      >
        {isLoading ? (
          <div className="space-y-4" role="status" aria-label="Carregando">
            <span className="skeleton block h-9 w-72" />
            <span className="skeleton block h-16" />
            <span className="skeleton block h-40" />
          </div>
        ) : loadError || !employee ? (
          <Notice tone="danger">{loadError ?? 'Não foi possível carregar.'}</Notice>
        ) : (
          <>
            <Tabs<Tab> label="Seções do funcionário" tabs={tabs} value={activeTab} onChange={handleTabChange} className="-mx-6 px-6 mb-5" />
            {actionError && <Notice tone="danger" className="mb-4">{actionError}</Notice>}
            {ownNote && <OwnDataNote className="mb-4" />}
            {activeTab === 'finance' && canManagePayments && financeTab}
            {activeTab === 'vacation' && vacationTab}
            {activeTab === 'leave' && leaveTab}
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmingRecurring}
        onClose={() => setConfirmingDeleteId(null)}
        onConfirm={() => confirmingDeleteId && handleDeleteRecurringPayment(confirmingDeleteId)}
        busy={!!confirmingDeleteId && busyId === confirmingDeleteId}
        tone="danger"
        title="Excluir pagamento recorrente?"
        description={confirmingRecurring
          ? `“${confirmingRecurring.description}” deixa de ser gerado todo mês. Os pagamentos já gerados continuam no histórico.`
          : undefined}
        confirmLabel="Excluir"
      />
    </>
  );
};

export default FinanceAndVacationModal;
