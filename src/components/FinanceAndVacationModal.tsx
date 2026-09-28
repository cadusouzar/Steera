import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, DollarSign, Calendar, Umbrella, AlertCircle, CheckCircle2, Clock, History, Repeat, Zap, Loader2, Briefcase, Undo2, Trash2, Ban, RotateCcw } from 'lucide-react';
import * as api from '../lib/api';
import { useCan, useCurrentUser } from '../lib/auth';
import { isOwnDataLocked } from '../lib/grantCoverage';
import OwnDataNote from './OwnDataNote';
import { ApiError } from '../lib/apiError';
import type { EmployeeDetail, EmployeePaymentRecord, EmployeeRecurringPaymentRecord } from '../lib/api';

interface FinanceAndVacationModalProps {
  employeeId: string;
  onClose: () => void;
}

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

// Formata uma data-only string (ex.: "2026-09-01" ou "2026-09-01T00:00:00.000Z") sem
// passar por `Date`/`toLocaleDateString`, que converteriam para o fuso horário local do
// navegador e podem exibir o dia anterior em fusos com offset negativo (ex.: Brasil, UTC-3).
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

const FinanceAndVacationModal: React.FC<FinanceAndVacationModalProps> = ({ employeeId, onClose }) => {
  // Permissões por ação (27/09/2026): pagamentos (ler e escrever) exigem `pagamentos.gerenciar`,
  // então sem ela a aba Pagamentos nem aparece e nada de pagamento é buscado; agendar/cancelar/
  // retomar férias e afastamentos exige `ferias.gerenciar` (o histórico continua visível).
  const can = useCan();
  const canManagePayments = can('pagamentos.gerenciar');
  const canManageVacations = can('ferias.gerenciar');
  // Na própria ficha, escrever (pagamentos, recorrências, férias, afastamentos) também exige
  // "Pode alterar os próprios dados?" no perfil; sem ela o backend recusa com 403. Ler continua livre.
  const currentUser = useCurrentUser();
  const isOwnLocked = isOwnDataLocked(currentUser, employeeId);
  const canWritePayments = canManagePayments && !isOwnLocked;
  const canWriteVacations = canManageVacations && !isOwnLocked;
  const [activeTab, setActiveTab] = useState<'finance' | 'vacation' | 'leave'>(canManagePayments ? 'finance' : 'vacation');
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

  const loadFinance = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [detail, paymentList, recurringList, schedules, leaveList] = await Promise.all([
        api.getEmployee(employeeId),
        canManagePayments ? emptyWhenOutOfScope(api.listEmployeePayments(employeeId)) : Promise.resolve([] as EmployeePaymentRecord[]),
        canManagePayments ? emptyWhenOutOfScope(api.listEmployeeRecurringPayments(employeeId)) : Promise.resolve([] as EmployeeRecurringPaymentRecord[]),
        api.listVacationSchedules(employeeId),
        api.listLeaveSchedules(employeeId),
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
  }, [employeeId, canManagePayments]);

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

  // Diferente de `handleMarkAsPaid`, não dá pra assumir localmente o novo status após desfazer
  // o pagamento: 'paid' é inequívoco, mas ao voltar pra "não pago" o status derivado pelo backend
  // pode ser 'pending' OU 'overdue' dependendo se `dueDate` já passou. Por isso recarregamos a
  // lista inteira do servidor em vez de tentar adivinhar.
  const handleUnmarkAsPaid = async (paymentId: string) => {
    setBusyId(paymentId);
    setActionError(null);
    try {
      await api.unpayEmployeePayment(paymentId);
      setPayments(await api.listEmployeePayments(employeeId));
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
      setRecurringPayments(await api.listEmployeeRecurringPayments(employeeId));
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
      setVacationSchedules(await api.listVacationSchedules(employeeId));
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
      setLeaveSchedules(await api.listLeaveSchedules(employeeId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível cancelar o afastamento.');
    } finally {
      setBusyId(null);
    }
  };

  // Espelha handleCancelVacation, mas com a mesma UX de "reenviar com exceção" já usada em
  // handleConfirmSchedule: a 1ª tentativa nunca manda exceptionAuthorized; se o backend rejeitar
  // por causa do teto de 30 dias, lembramos QUAL linha disparou o erro (resumeCapErrorId) pra
  // mostrar o checkbox só ali. Qualquer outro tipo de erro (ex.: sobreposição) limpa esse estado,
  // pra nunca deixar um checkbox obsoleto visível numa linha errada.
  const handleResumeVacation = async (scheduleId: string) => {
    setBusyId(scheduleId);
    setActionError(null);
    try {
      await api.resumeVacationSchedule(scheduleId, resumeCapErrorId === scheduleId ? resumeExceptionAuthorized : undefined);
      setVacationSchedules(await api.listVacationSchedules(employeeId));
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
      setLeaveSchedules(await api.listLeaveSchedules(employeeId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível retomar o afastamento.');
    } finally {
      setBusyId(null);
    }
  };

  const daysBetween = (start: string, end: string) => {
    if (!start || !end) return 0;
    const diff = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
    return Math.round(diff / 86_400_000) + 1;
  };

  const handleConfirmSchedule = async () => {
    if (!scheduleStart || !scheduleEnd || isScheduling) return;
    setIsScheduling(true);
    setActionError(null);
    // Uma nova tentativa de agendamento não pode herdar o checkbox de exceção de um "Retomar"
    // de outra linha que tenha ficado pendente — evita o form e uma linha do histórico
    // mostrando checkbox de exceção ao mesmo tempo por motivos diferentes (ver condição do
    // checkbox do form logo abaixo, que também depende de `resumeCapErrorId`).
    setResumeCapErrorId(null);
    setResumeExceptionAuthorized(false);
    try {
      await api.scheduleVacation(employeeId, {
        startDate: scheduleStart, endDate: scheduleEnd, daysCount: daysBetween(scheduleStart, scheduleEnd), exceptionAuthorized,
      });
      setVacationSchedules(await api.listVacationSchedules(employeeId));
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

  const handleScheduleLeave = async () => {
    if (!leaveScheduleStart || !leaveScheduleEnd || isSchedulingLeave) return;
    setIsSchedulingLeave(true);
    setActionError(null);
    try {
      await api.scheduleLeave(employeeId, {
        startDate: leaveScheduleStart,
        endDate: leaveScheduleEnd,
        daysCount: daysBetween(leaveScheduleStart, leaveScheduleEnd),
        reason: leaveReason || undefined,
      });
      setLeaveSchedules(await api.listLeaveSchedules(employeeId));
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

  const getPaymentStatusIcon = (status: string) => {
    switch (status) {
      case 'paid': return <CheckCircle2 size={16} className="text-green-500" />;
      case 'overdue': return <AlertCircle size={16} className="text-red-500" />;
      default: return <Clock size={16} className="text-orange-500" />;
    }
  };

  const getPaymentStatusText = (status: string) => {
    switch (status) {
      case 'paid': return 'Pago';
      case 'overdue': return 'Atrasado';
      default: return 'Pendente';
    }
  };

  const getPaymentStatusStyle = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'overdue': return 'bg-red-500/10 text-red-600 border-red-500/20';
      default: return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    }
  };

  const getScheduleStatusText = (status: api.VacationScheduleRecord['status']) => {
    switch (status) {
      case 'completed': return 'Concluído';
      case 'in_progress': return 'Em andamento';
      case 'approved': return 'Aprovado';
      case 'cancelled': return 'Cancelado';
      default: return 'Agendado';
    }
  };

  const getScheduleStatusStyle = (status: api.VacationScheduleRecord['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'cancelled': return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'in_progress': return 'bg-accent/10 text-accent border-accent/20';
      default: return 'bg-primary/10 text-primary border-primary/20';
    }
  };

  const vacationUnavailable = employee?.contractType !== 'clt';
  const vacationCapExceeded = !!actionError && actionError.includes('Limite de 30 dias');

  // `actionError` é um estado único compartilhado entre as abas Férias e Afastamento — trocar de
  // aba sem limpá-lo deixaria o banner (e, no caso do teto de 30 dias, o checkbox de exceção)
  // vazar de uma aba pra outra sem nenhuma submissão nova ter acontecido ali. `resumeCapErrorId`/
  // `resumeExceptionAuthorized` seguem a mesma regra: são específicos da linha de "Retomar" que
  // gerou o erro, então também não devem sobreviver a uma troca de aba.
  const handleTabChange = (tab: 'finance' | 'vacation' | 'leave') => {
    setActionError(null);
    setResumeCapErrorId(null);
    setResumeExceptionAuthorized(false);
    setActiveTab(tab);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[120] bg-background/80 backdrop-blur-sm flex justify-center items-center p-4 md:p-6"
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="bg-background border border-border/60 rounded-[2rem] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />

          {isLoading || !employee ? (
            <div className="p-16 flex flex-col items-center justify-center gap-4 text-center flex-1">
              {loadError ? (
                <>
                  <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-600 dark:text-red-400 text-sm">
                    {loadError}
                  </div>
                  <button
                    onClick={onClose}
                    className="px-5 py-2.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Fechar
                  </button>
                </>
              ) : (
                <Loader2 className="animate-spin text-muted" size={32} />
              )}
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-6 md:p-8 border-b border-border/40 flex items-start justify-between shrink-0">
                <div className="flex items-center gap-4 mt-2">
                  <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-2xl shadow-sm shrink-0">
                    {employee.fullName.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-2xl font-heading font-bold text-foreground">
                      {employee.fullName}
                    </h2>
                    <div className="text-muted text-sm font-medium flex items-center gap-2 mt-1">
                      <span className="uppercase text-xs font-bold tracking-wider">{employee.contractType}</span>
                      <span>•</span>
                      <span>Admitido em {formatDateOnly(employee.admissionDate)}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors mt-2"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border/50 px-6 md:px-8 shrink-0">
                {canManagePayments && (
                <button
                  onClick={() => handleTabChange('finance')}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-bold transition-colors border-b-2 whitespace-nowrap ${activeTab === 'finance'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-foreground'
                    }`}
                >
                  <DollarSign size={16} /> Pagamentos
                </button>
                )}
                <button
                  onClick={() => handleTabChange('vacation')}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-bold transition-colors border-b-2 whitespace-nowrap ${activeTab === 'vacation'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-foreground'
                    }`}
                >
                  <Umbrella size={16} /> Férias
                </button>
                <button
                  onClick={() => handleTabChange('leave')}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-bold transition-colors border-b-2 whitespace-nowrap ${activeTab === 'leave'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-foreground'
                    }`}
                >
                  <Briefcase size={16} /> Afastamento
                </button>
              </div>

              {/* Body */}
              <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1">
                {activeTab === 'finance' && canManagePayments && (
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    {actionError && (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2">
                        <AlertCircle size={16} className="shrink-0" /> {actionError}
                      </div>
                    )}

                    {isOwnLocked && <OwnDataNote />}

                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 bg-secondary/20 p-5 rounded-2xl border border-border/40">
                      <div>
                        <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Salário Base</p>
                        <p className="text-2xl font-bold text-foreground">{formatCurrency(employee.baseValue)}</p>
                      </div>
                      <div className="hidden md:block w-px h-10 bg-border/50"></div>
                      <div>
                        <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Dia de Pagamento</p>
                        <p className="text-sm font-medium text-foreground">
                          {employee.paymentDay === 'last' ? 'Último dia útil do mês' : `Todo dia ${employee.paymentDay}`}
                        </p>
                      </div>
                    </div>

                    {recurringPayments.filter(r => r.status === 'active').length > 0 && (
                      <div>
                        <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2 mb-4 mt-6">
                          <Repeat size={18} className="text-accent" /> Pagamento Recorrente
                        </h3>
                        <div className="space-y-3">
                          {recurringPayments.filter(r => r.status === 'active').map((r) => (
                            <div key={r.id} className="flex flex-col p-4 bg-accent/5 border border-accent/20 rounded-2xl relative overflow-hidden transition-colors hover:border-accent/40">
                              <div className="absolute top-0 left-0 bottom-0 w-1 bg-accent"></div>

                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div>
                                  <p className="font-bold text-foreground flex items-center gap-2">
                                    {r.description}
                                    <span className="px-2 py-0.5 rounded-md text-[10px] uppercase font-bold bg-accent/10 text-accent">Recorrente</span>
                                  </p>
                                  <div className="flex items-center gap-3 mt-1.5">
                                    <span className="text-sm font-bold text-foreground/80">{formatCurrency(r.amount)}</span>
                                    <span className="text-xs text-muted flex items-center gap-1"><Calendar size={12} /> Vence todo dia {r.dueDay}</span>
                                  </div>
                                </div>

                                {canWritePayments && (
                                <div className="flex flex-col items-end gap-2">
                                  {confirmingDeleteId === r.id ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-bold text-foreground/80">Confirmar exclusão?</span>
                                      <button
                                        onClick={() => setConfirmingDeleteId(null)}
                                        disabled={busyId === r.id}
                                        className="text-xs font-bold text-foreground hover:bg-secondary/80 px-2.5 py-1.5 rounded-lg border border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        Cancelar
                                      </button>
                                      <button
                                        onClick={() => handleDeleteRecurringPayment(r.id)}
                                        disabled={busyId === r.id}
                                        className="flex items-center gap-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        {busyId === r.id && <Loader2 size={12} className="animate-spin" />} Confirmar
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => handleGenerateCharge(r.id)}
                                        disabled={busyId === r.id}
                                        className="flex items-center gap-1.5 text-xs font-bold text-accent hover:text-white bg-accent/10 hover:bg-accent px-3 py-2 rounded-xl transition-all border border-accent/20 hover:border-accent shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                      >
                                        {busyId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Gerar Fatura do Mês
                                      </button>
                                      <button
                                        onClick={() => setConfirmingDeleteId(r.id)}
                                        disabled={busyId === r.id}
                                        className="flex items-center gap-1.5 text-xs font-bold text-muted hover:text-red-600 bg-secondary/40 hover:bg-red-500/10 px-3 py-2 rounded-xl transition-all border border-border/60 hover:border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Excluir pagamento recorrente"
                                      >
                                        <Trash2 size={14} /> Excluir
                                      </button>
                                    </div>
                                  )}
                                </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h3 className="text-lg font-heading font-bold text-foreground mb-4 flex items-center gap-2 mt-6">
                        <History size={18} className="text-primary/70" /> Histórico de Pagamentos
                      </h3>
                      <div className="space-y-3">
                        {payments.length > 0 ? (
                          payments.map((payment) => (
                            <div key={payment.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-background border border-border/60 rounded-xl hover:border-primary/30 transition-colors gap-4">
                              <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${payment.status === 'paid' ? 'bg-green-500/10 text-green-500' : payment.status === 'overdue' ? 'bg-red-500/10 text-red-500' : 'bg-orange-500/10 text-orange-500'}`}>
                                  <DollarSign size={20} />
                                </div>
                                <div>
                                  <p className="font-bold text-foreground">{payment.description}</p>
                                  <p className="text-sm text-muted">{formatDateOnly(payment.dueDate)} • {formatCurrency(payment.amount)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 justify-between sm:justify-end">
                                <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${getPaymentStatusStyle(payment.status)}`}>
                                  {getPaymentStatusIcon(payment.status)}
                                  {getPaymentStatusText(payment.status)}
                                </span>
                                {!canWritePayments ? null : payment.status !== 'paid' ? (
                                  <button
                                    onClick={() => handleMarkAsPaid(payment.id)}
                                    disabled={busyId === payment.id}
                                    className="text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                  >
                                    {busyId === payment.id && <Loader2 size={12} className="animate-spin" />} Marcar Pago
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleUnmarkAsPaid(payment.id)}
                                    disabled={busyId === payment.id}
                                    className="text-xs font-bold text-muted hover:text-foreground bg-secondary/40 hover:bg-secondary/70 px-3 py-1.5 rounded-lg border border-border/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                    title="Desfazer pagamento"
                                  >
                                    {busyId === payment.id ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />} Desfazer
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-10 bg-secondary/10 border border-border/40 border-dashed rounded-2xl">
                            <p className="text-sm font-bold text-foreground">Nenhum registro encontrado</p>
                            <p className="text-xs text-muted mt-1">Este funcionário ainda não possui histórico de pagamentos.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'vacation' && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    {actionError && (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2">
                        <AlertCircle size={16} className="shrink-0" /> {actionError}
                      </div>
                    )}
                    {canManageVacations && isOwnLocked && <OwnDataNote />}

                    {isSchedulingOpen && vacationCapExceeded && resumeCapErrorId === null && (
                      <label className="flex items-center gap-2.5 px-4 py-3 bg-secondary/20 border border-border/40 rounded-xl text-sm text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={exceptionAuthorized}
                          onChange={(e) => setExceptionAuthorized(e.target.checked)}
                          className="rounded border-border/80"
                        />
                        Autorizar exceção e agendar mesmo assim, ultrapassando os 30 dias
                      </label>
                    )}

                    {vacationUnavailable ? (
                      <div className="text-center py-16 bg-secondary/10 border border-border/40 border-dashed rounded-2xl px-6">
                        <div className="w-16 h-16 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center mx-auto mb-4">
                          <Umbrella size={28} />
                        </div>
                        <h3 className="text-lg font-bold text-foreground mb-2">Férias Indisponíveis</h3>
                        <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">
                          Este funcionário possui um contrato do tipo <strong className="uppercase text-foreground">{employee.contractType}</strong>.
                          A gestão de férias de 30 dias está disponível apenas para funcionários <strong>CLT</strong>, de acordo com as leis trabalhistas.
                        </p>
                      </div>
                    ) : (
                      <>
                        {isSchedulingOpen && (
                          <div className="bg-secondary/10 border border-border/40 rounded-2xl p-5 space-y-4">
                            <h4 className="text-sm font-bold text-foreground">Agendar novo período</h4>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Data de Início</label>
                                <input type="date" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Data de Fim</label>
                                <input type="date" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                            </div>

                            <div className="flex gap-3 pt-2">
                              <button
                                onClick={() => { setIsSchedulingOpen(false); setScheduleStart(''); setScheduleEnd(''); setExceptionAuthorized(false); setActionError(null); }}
                                className="flex-1 py-2.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={handleConfirmSchedule}
                                disabled={!scheduleStart || !scheduleEnd || isScheduling}
                                className="flex-1 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
                              >
                                {isScheduling ? 'Agendando...' : 'Confirmar Agendamento'}
                              </button>
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="flex items-center justify-between mb-4 mt-8">
                            <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2">
                              <History size={18} className="text-primary/70" /> Histórico de Férias
                            </h3>
                            {canWriteVacations && (
                            <button
                              onClick={() => { setIsSchedulingOpen(true); setExceptionAuthorized(false); setActionError(null); setResumeCapErrorId(null); setResumeExceptionAuthorized(false); }}
                              disabled={isSchedulingOpen}
                              className="text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Agendar Férias
                            </button>
                            )}
                          </div>

                          <div className="space-y-3">
                            {vacationSchedules.length > 0 ? (
                              vacationSchedules.map((sched) => (
                                <div key={sched.id} className="flex flex-col p-4 bg-background border border-border/60 rounded-xl gap-3">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 rounded-full bg-secondary/50 text-muted flex items-center justify-center shrink-0">
                                        <Umbrella size={14} />
                                      </div>
                                      <div>
                                        <p className="text-sm font-bold text-foreground">
                                          {formatDateOnly(sched.startDate)} até {formatDateOnly(sched.endDate)}
                                        </p>
                                        <p className="text-xs text-muted mt-0.5">{sched.daysCount} dias</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${getScheduleStatusStyle(sched.status)}`}>
                                        {getScheduleStatusText(sched.status)}
                                      </span>
                                      {canWriteVacations && (sched.status === 'scheduled' || sched.status === 'approved') && (
                                        <button
                                          onClick={() => handleCancelVacation(sched.id)}
                                          disabled={busyId === sched.id}
                                          className="flex items-center gap-1.5 text-xs font-bold text-muted hover:text-red-600 bg-secondary/40 hover:bg-red-500/10 px-3 py-1.5 rounded-lg border border-border/60 hover:border-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          {busyId === sched.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} Cancelar
                                        </button>
                                      )}
                                      {canWriteVacations && sched.status === 'cancelled' && (
                                        <button
                                          onClick={() => handleResumeVacation(sched.id)}
                                          disabled={busyId === sched.id}
                                          className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg border border-primary/20 hover:border-primary/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          {busyId === sched.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Retomar
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {resumeCapErrorId === sched.id && (
                                    <label className="flex items-center gap-2.5 px-4 py-3 bg-secondary/20 border border-border/40 rounded-xl text-sm text-foreground cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={resumeExceptionAuthorized}
                                        onChange={(e) => setResumeExceptionAuthorized(e.target.checked)}
                                        className="rounded border-border/80"
                                      />
                                      Autorizar exceção e retomar mesmo assim, ultrapassando os 30 dias
                                    </label>
                                  )}
                                </div>
                              ))
                            ) : (
                              <div className="text-center py-8 bg-secondary/10 border border-border/40 border-dashed rounded-2xl">
                                <p className="text-sm font-bold text-foreground">Nenhuma férias tirada</p>
                                <p className="text-xs text-muted mt-1">Este funcionário ainda não utilizou seu saldo de férias.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </motion.div>
                )}

                {activeTab === 'leave' && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    {actionError && (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2">
                        <AlertCircle size={16} className="shrink-0" /> {actionError}
                      </div>
                    )}
                    {canManageVacations && isOwnLocked && <OwnDataNote />}

                    {isLeaveSchedulingOpen && (
                      <div className="bg-secondary/10 border border-border/40 rounded-2xl p-5 space-y-4">
                        <h4 className="text-sm font-bold text-foreground">Agendar Afastamento</h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1.5">Data de Início</label>
                            <input type="date" value={leaveScheduleStart} onChange={(e) => setLeaveScheduleStart(e.target.value)} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1.5">Data de Fim</label>
                            <input type="date" value={leaveScheduleEnd} onChange={(e) => setLeaveScheduleEnd(e.target.value)} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground/80 mb-1.5">Motivo (opcional)</label>
                          <input type="text" value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Ex.: Licença médica" className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                        </div>

                        <div className="flex gap-3 pt-2">
                          <button
                            onClick={() => { setIsLeaveSchedulingOpen(false); setLeaveScheduleStart(''); setLeaveScheduleEnd(''); setLeaveReason(''); }}
                            className="flex-1 py-2.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={handleScheduleLeave}
                            disabled={!leaveScheduleStart || !leaveScheduleEnd || isSchedulingLeave}
                            className="flex-1 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
                          >
                            {isSchedulingLeave ? 'Agendando...' : 'Confirmar Agendamento'}
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-4 mt-8">
                        <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2">
                          <History size={18} className="text-primary/70" /> Histórico de Afastamentos
                        </h3>
                        {canWriteVacations && (
                        <button
                          onClick={() => setIsLeaveSchedulingOpen(true)}
                          disabled={isLeaveSchedulingOpen}
                          className="text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Agendar Afastamento
                        </button>
                        )}
                      </div>

                      <div className="space-y-3">
                        {leaveSchedules.length > 0 ? (
                          leaveSchedules.map((sched) => (
                            <div key={sched.id} className="flex items-center justify-between p-4 bg-background border border-border/60 rounded-xl">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-secondary/50 text-muted flex items-center justify-center shrink-0">
                                  <Briefcase size={14} />
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-foreground">
                                    {formatDateOnly(sched.startDate)} até {formatDateOnly(sched.endDate)}
                                  </p>
                                  <p className="text-xs text-muted mt-0.5">{sched.daysCount} dias</p>
                                  {sched.reason && (
                                    <p className="text-xs text-muted mt-0.5">{sched.reason}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${getScheduleStatusStyle(sched.status)}`}>
                                  {getScheduleStatusText(sched.status)}
                                </span>
                                {canWriteVacations && (sched.status === 'scheduled' || sched.status === 'approved') && (
                                  <button
                                    onClick={() => handleCancelLeave(sched.id)}
                                    disabled={busyId === sched.id}
                                    className="flex items-center gap-1.5 text-xs font-bold text-muted hover:text-red-600 bg-secondary/40 hover:bg-red-500/10 px-3 py-1.5 rounded-lg border border-border/60 hover:border-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {busyId === sched.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} Cancelar
                                  </button>
                                )}
                                {canWriteVacations && sched.status === 'cancelled' && (
                                  <button
                                    onClick={() => handleResumeLeave(sched.id)}
                                    disabled={busyId === sched.id}
                                    className="flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg border border-primary/20 hover:border-primary/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {busyId === sched.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Retomar
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-8 bg-secondary/10 border border-border/40 border-dashed rounded-2xl">
                            <p className="text-sm font-bold text-foreground">Nenhum afastamento registrado</p>
                            <p className="text-xs text-muted mt-1">Este funcionário ainda não possui histórico de afastamentos.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default FinanceAndVacationModal;
