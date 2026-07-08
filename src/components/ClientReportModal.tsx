import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, AlertCircle, Clock, CheckCircle2, DollarSign, Printer, Download, Users } from 'lucide-react';
import type { Client } from '../pages/app/ClientsList';

interface ClientReportModalProps {
  clients: Client[];
  onClose: () => void;
}

const ClientReportModal: React.FC<ClientReportModalProps> = ({ clients, onClose }) => {

  // Metrics Calculation
  const totalPaid = clients.reduce((acc, client) => {
    return acc + client.receivables.filter(r => r.status === 'paid').reduce((sum, r) => sum + r.amount, 0);
  }, 0);

  const totalPending = clients.reduce((acc, client) => {
    return acc + client.receivables.filter(r => r.status === 'pending').reduce((sum, r) => sum + r.amount, 0);
  }, 0);

  const totalOverdue = clients.reduce((acc, client) => {
    return acc + client.receivables.filter(r => r.status === 'overdue').reduce((sum, r) => sum + r.amount, 0);
  }, 0);

  const totalRecurring = clients.reduce((acc, client) => {
    return acc + client.subscriptions.filter(s => s.status === 'active').reduce((sum, s) => sum + s.amount, 0);
  }, 0);

  // Top Defaulters
  const defaulters = clients.map(c => {
    const overdueAmount = c.receivables.filter(r => r.status === 'overdue').reduce((sum, r) => sum + r.amount, 0);
    return { name: c.name, category: c.category, amount: overdueAmount, contact: c.contact };
  }).filter(d => d.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 5);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const handlePrint = () => {
    window.print();
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
          className="bg-background border border-border/60 rounded-[2rem] w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl relative overflow-hidden print:w-full print:max-h-none print:border-none print:shadow-none"
        >
          {/* Header */}
          <div className="p-6 md:p-8 border-b border-border flex justify-between items-center bg-secondary/10 shrink-0 print:bg-transparent">
            <div>
              <h2 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
                <TrendingUp className="text-primary" size={24} /> 
                Relatório Financeiro Geral
              </h2>
              <p className="text-muted text-sm mt-1">Visão macro de todos os clientes e recebimentos.</p>
            </div>
            
            <div className="flex items-center gap-3 print:hidden">
              <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border/80 text-foreground font-medium hover:bg-secondary transition-colors text-sm shadow-sm">
                <Printer size={16} /> Imprimir
              </button>
              <button onClick={onClose} className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8 space-y-8 print:overflow-visible">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-sm font-medium text-muted">Receita Recebida</h3>
                  <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                    <CheckCircle2 size={16} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground">{formatCurrency(totalPaid)}</p>
                <p className="text-xs text-muted mt-1">Total pago pelos clientes</p>
              </div>

              <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-sm font-medium text-muted">A Receber (Pendente)</h3>
                  <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
                    <Clock size={16} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground">{formatCurrency(totalPending)}</p>
                <p className="text-xs text-muted mt-1">Lançamentos no prazo</p>
              </div>

              <div className="bg-background border border-red-500/30 rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-sm font-medium text-muted">Total em Atraso</h3>
                  <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                    <AlertCircle size={16} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-red-500">{formatCurrency(totalOverdue)}</p>
                <p className="text-xs text-muted mt-1">Valores vencidos</p>
              </div>

              <div className="bg-accent/5 border border-accent/30 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-accent/10 rounded-bl-full -mr-4 -mt-4 blur-xl"></div>
                <div className="flex justify-between items-start mb-2 relative z-10">
                  <h3 className="text-sm font-medium text-accent">Receita Recorrente</h3>
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent">
                    <DollarSign size={16} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground relative z-10">{formatCurrency(totalRecurring)}</p>
                <p className="text-xs text-accent mt-1 relative z-10">Mensalidades / mês</p>
              </div>
            </div>

            {/* Top Defaulters Table */}
            <div>
              <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2 mb-4">
                <Users size={18} className="text-red-500" /> Ranking de Inadimplência
              </h3>
              
              {defaulters.length > 0 ? (
                <div className="bg-background border border-border rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b-2 border-border/60 bg-secondary/10">
                        <th className="px-6 py-4 text-xs font-heading font-semibold text-foreground/90 uppercase tracking-wider">Cliente</th>
                        <th className="px-6 py-4 text-xs font-heading font-semibold text-foreground/90 uppercase tracking-wider">Contato</th>
                        <th className="px-6 py-4 text-xs font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Valor Atrasado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {defaulters.map((d, index) => (
                        <tr key={index} className="hover:bg-secondary/10 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-bold text-foreground">{d.name}</div>
                            <div className="text-xs text-muted">{d.category}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-foreground/80">{d.contact}</td>
                          <td className="px-6 py-4 text-right">
                            <span className="font-bold text-red-500">{formatCurrency(d.amount)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-10 bg-green-500/5 border border-green-500/20 border-dashed rounded-2xl">
                  <CheckCircle2 size={32} className="mx-auto text-green-500 mb-3" />
                  <p className="text-sm font-bold text-green-600">Nenhum cliente inadimplente!</p>
                  <p className="text-xs text-green-600/70 mt-1">Todos os lançamentos estão em dia ou pendentes no prazo.</p>
                </div>
              )}
            </div>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ClientReportModal;
