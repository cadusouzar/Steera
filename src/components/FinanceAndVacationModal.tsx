import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, DollarSign, Calendar, Umbrella, AlertCircle, CheckCircle2, Clock, History, ChevronRight, Repeat, Zap } from 'lucide-react';

interface Payment {
  id: string;
  month: string;
  year: number;
  status: 'paid' | 'pending' | 'overdue';
  amount: string;
}

export interface EmployeeFinanceData {
  id: string;
  name: string;
  role: string;
  department: string;
  salary: string;
  admissionDate: string;
  contractType?: string;
  paymentDay?: string;
  payments: Payment[];
  vacation: {
    daysTaken: number;
    history: { startDate: string; endDate: string }[];
  };
}

interface FinanceAndVacationModalProps {
  employee: EmployeeFinanceData;
  onClose: () => void;
  onMarkAsPaid: (paymentId: string) => void;
  onScheduleVacation: (days: number) => void;
}

const FinanceAndVacationModal: React.FC<FinanceAndVacationModalProps> = ({ employee, onClose, onMarkAsPaid, onScheduleVacation }) => {
  const [activeTab, setActiveTab] = useState<'finance' | 'vacation'>('finance');

  // Cálculo de Férias CLT (1 ano = 30 dias)
  const calculateVacation = () => {
    if (employee.contractType !== 'clt') return null;

    const admission = new Date(employee.admissionDate);
    const today = new Date();

    // Meses de trabalho
    const monthsWorked = (today.getFullYear() - admission.getFullYear()) * 12 + (today.getMonth() - admission.getMonth());
    const yearsWorked = monthsWorked / 12;

    const totalAcquiredDays = Math.floor(yearsWorked) * 30; // 30 dias a cada ano fechado

    // Calcula dias proporcionais do período aquisitivo atual
    const currentPeriodMonths = monthsWorked % 12;
    const proportionalDays = Math.floor((currentPeriodMonths / 12) * 30);

    const balance = totalAcquiredDays - employee.vacation.daysTaken;

    return {
      yearsWorked: Math.floor(yearsWorked),
      monthsWorked,
      totalAcquiredDays,
      balance: balance < 0 ? 0 : balance,
      proportionalDays,
      isAcquisitionComplete: yearsWorked >= 1
    };
  };

  const vacationData = calculateVacation();

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

          {/* Header */}
          <div className="p-6 md:p-8 border-b border-border/40 flex items-start justify-between shrink-0">
            <div className="flex items-center gap-4 mt-2">
              <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-2xl shadow-sm shrink-0">
                {employee.name.charAt(0)}
              </div>
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground">
                  {employee.name}
                </h2>
                <div className="text-muted text-sm font-medium flex items-center gap-2 mt-1">
                  <span className="uppercase text-xs font-bold tracking-wider">{employee.contractType || 'N/A'}</span>
                  <span>•</span>
                  <span>{employee.role}</span>
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
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 bg-secondary/20 p-5 rounded-2xl border border-border/40">
                  <div>
                    <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Salário Base</p>
                    <p className="text-2xl font-bold text-foreground">{employee.salary || 'Não informado'}</p>
                  </div>
                  <div className="hidden md:block w-px h-10 bg-border/50"></div>
                  <div>
                    <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Dia de Pagamento</p>
                    <p className="text-sm font-medium text-foreground">
                      {employee.paymentDay === 'last' ? 'Último dia útil do mês' : (employee.paymentDay ? `Todo dia ${employee.paymentDay}` : 'Não informado')}
                    </p>
                  </div>
                </div>

                {employee.salaryRecurrence !== false && (
                  <div>
                    <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2 mb-4 mt-6">
                      <Repeat size={18} className="text-accent" /> Pagamento Recorrente
                    </h3>
                    <div className="flex flex-col p-4 bg-accent/5 border border-accent/20 rounded-2xl relative overflow-hidden transition-colors hover:border-accent/40">
                      <div className="absolute top-0 left-0 bottom-0 w-1 bg-accent"></div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <p className="font-bold text-foreground flex items-center gap-2">
                            Salário Mensal Automático
                            <span className="px-2 py-0.5 rounded-md text-[10px] uppercase font-bold bg-accent/10 text-accent">Recorrente</span>
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-sm font-bold text-foreground/80">{employee.salary}</span>
                            <span className="text-xs text-muted flex items-center gap-1"><Calendar size={12} /> Vence todo {employee.paymentDay === 'last' ? 'último dia útil' : `dia ${employee.paymentDay}`}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <button
                            className="flex items-center gap-1.5 text-xs font-bold text-accent hover:text-white bg-accent/10 hover:bg-accent px-3 py-2 rounded-xl transition-all border border-accent/20 hover:border-accent shadow-sm"
                          >
                            <Zap size={14} /> Gerar Fatura do Mês
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-lg font-heading font-bold text-foreground mb-4 flex items-center gap-2 mt-6">
                    <History size={18} className="text-primary/70" /> Histórico de Pagamentos
                  </h3>
                  <div className="space-y-3">
                    {employee.payments.length > 0 ? (
                      employee.payments.map((payment) => (
                        <div key={payment.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-background border border-border/60 rounded-xl hover:border-primary/30 transition-colors gap-4">
                          <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${payment.status === 'paid' ? 'bg-green-500/10 text-green-500' : payment.status === 'overdue' ? 'bg-red-500/10 text-red-500' : 'bg-orange-500/10 text-orange-500'}`}>
                              <DollarSign size={20} />
                            </div>
                            <div>
                              <p className="font-bold text-foreground capitalize">{payment.month} de {payment.year}</p>
                              <p className="text-sm text-muted">{payment.amount}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 justify-between sm:justify-end">
                            <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${getPaymentStatusStyle(payment.status)}`}>
                              {getPaymentStatusIcon(payment.status)}
                              {getPaymentStatusText(payment.status)}
                            </span>
                            {payment.status !== 'paid' && (
                              <button
                                onClick={() => onMarkAsPaid(payment.id)}
                                className="text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors"
                              >
                                Marcar Pago
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
                {employee.contractType !== 'clt' ? (
                  <div className="text-center py-16 bg-secondary/10 border border-border/40 border-dashed rounded-2xl px-6">
                    <div className="w-16 h-16 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center mx-auto mb-4">
                      <Umbrella size={28} />
                    </div>
                    <h3 className="text-lg font-bold text-foreground mb-2">Férias Indisponíveis</h3>
                    <p className="text-sm text-muted max-w-md mx-auto leading-relaxed">
                      Este funcionário possui um contrato do tipo <strong className="uppercase text-foreground">{employee.contractType || 'N/A'}</strong>.
                      A gestão de férias de 30 dias está disponível apenas para funcionários <strong>CLT</strong>, de acordo com as leis trabalhistas.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="bg-primary/10 border border-primary/20 p-5 rounded-2xl">
                        <p className="text-xs text-primary/80 uppercase font-bold tracking-wider mb-1 flex items-center gap-1.5">
                          <Calendar size={14} /> Admissão
                        </p>
                        <p className="text-xl font-bold text-primary">
                          {new Date(employee.admissionDate).toLocaleDateString('pt-BR')}
                        </p>
                        <p className="text-xs text-primary/70 mt-1">
                          {vacationData?.yearsWorked} anos e {vacationData ? vacationData.monthsWorked % 12 : 0} meses
                        </p>
                      </div>

                      <div className="bg-background border border-border/60 p-5 rounded-2xl shadow-sm">
                        <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Saldo Disponível</p>
                        <p className="text-3xl font-bold text-foreground">{vacationData?.balance} <span className="text-lg text-muted font-medium">dias</span></p>
                        <p className="text-xs text-muted mt-1">
                          Para gozo imediato
                        </p>
                      </div>

                      <div className="bg-background border border-border/60 p-5 rounded-2xl shadow-sm">
                        <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Em Aquisição</p>
                        <p className="text-3xl font-bold text-foreground">{vacationData?.proportionalDays} <span className="text-lg text-muted font-medium">dias</span></p>
                        <p className="text-xs text-muted mt-1">
                          Proporcionais (ano vigente)
                        </p>
                      </div>
                    </div>

                    {!vacationData?.isAcquisitionComplete && (
                      <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-xl flex items-start gap-3">
                        <AlertCircle size={18} className="text-orange-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-bold text-orange-600 dark:text-orange-400">Período Aquisitivo Incompleto</p>
                          <p className="text-xs text-orange-600/80 dark:text-orange-400/80 mt-1">
                            O funcionário ainda não completou 1 ano de empresa. O direito a 30 dias de férias é concedido após o primeiro ano completo.
                          </p>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-4 mt-8">
                        <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2">
                          <History size={18} className="text-primary/70" /> Histórico de Férias Tiradas
                        </h3>
                        <button
                          onClick={() => onScheduleVacation(10)} // Simulated action
                          disabled={!vacationData?.balance || vacationData.balance === 0}
                          className="text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Agendar Férias
                        </button>
                      </div>

                      <div className="space-y-3">
                        {employee.vacation.history.length > 0 ? (
                          employee.vacation.history.map((hist, idx) => (
                            <div key={idx} className="flex items-center justify-between p-4 bg-background border border-border/60 rounded-xl">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-secondary/50 text-muted flex items-center justify-center shrink-0">
                                  <Umbrella size={14} />
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-foreground">
                                    {new Date(hist.startDate).toLocaleDateString('pt-BR')} até {new Date(hist.endDate).toLocaleDateString('pt-BR')}
                                  </p>
                                </div>
                              </div>
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
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default FinanceAndVacationModal;
