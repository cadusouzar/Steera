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
            <div className="p-16 flex items-center justify-center text-muted flex-1">
              {loadError ? loadError : <Loader2 className="animate-spin" size={32} />}
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
                      <span>Admitido em {new Date(employee.admissionDate).toLocaleDateString('pt-BR')}</span>
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
                <button
                  onClick={() => setActiveTab('finance')}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-bold transition-colors border-b-2 whitespace-nowrap ${activeTab === 'finance'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-foreground'
                    }`}
                >
                  <DollarSign size={16} /> Pagamentos
                </button>
                <button
                  onClick={() => setActiveTab('vacation')}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-bold transition-colors border-b-2 whitespace-nowrap ${activeTab === 'vacation'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted hover:text-foreground'
                    }`}
                >
                  <Umbrella size={16} /> Férias
                </button>
              </div>

              {/* Body */}
              <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1">
                {activeTab === 'finance' && (
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    {actionError && (
                      <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl text-sm font-medium flex items-center gap-2">
                        <AlertCircle size={16} className="shrink-0" /> {actionError}
                      </div>
                    )}

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

                                <div className="flex flex-col items-end gap-2">
                                  <button
                                    onClick={() => handleGenerateCharge(r.id)}
                                    disabled={busyId === r.id}
                                    className="flex items-center gap-1.5 text-xs font-bold text-accent hover:text-white bg-accent/10 hover:bg-accent px-3 py-2 rounded-xl transition-all border border-accent/20 hover:border-accent shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {busyId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Gerar Fatura do Mês
                                  </button>
                                </div>
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
                                  <p className="text-sm text-muted">{new Date(payment.dueDate).toLocaleDateString('pt-BR')} • {formatCurrency(payment.amount)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 justify-between sm:justify-end">
                                <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${getPaymentStatusStyle(payment.status)}`}>
                                  {getPaymentStatusIcon(payment.status)}
                                  {getPaymentStatusText(payment.status)}
                                </span>
                                {payment.status !== 'paid' && (
                                  <button
                                    onClick={() => handleMarkAsPaid(payment.id)}
                                    disabled={busyId === payment.id}
                                    className="text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                  >
                                    {busyId === payment.id && <Loader2 size={12} className="animate-spin" />} Marcar Pago
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
                    <div className="text-center py-16 bg-secondary/10 border border-border/40 border-dashed rounded-2xl px-6">
                      <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
                        <Umbrella size={28} />
                      </div>
                      <h3 className="text-lg font-bold text-foreground mb-2">Férias</h3>
                      <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">
                        A gestão de férias integrada ao backend chega em breve.
                      </p>
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
