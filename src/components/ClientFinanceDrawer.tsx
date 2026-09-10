import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, DollarSign, Calendar, AlertCircle, CheckCircle2, Clock, Plus, Receipt, FileText, Repeat, Zap, Trash2, Undo2, Loader2 } from 'lucide-react';
import type { Client, Receivable, Subscription } from '../pages/app/ClientsList';

// Parses a date-only "YYYY-MM-DD" string as local midnight instead of
// letting `new Date(str)` parse it as UTC midnight (which displays as the
// previous day in any timezone behind UTC, e.g. Brazil).
function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

interface ClientFinanceDrawerProps {
  client: Client;
  onClose: () => void;
  onMarkAsPaid: (clientId: string, receivableId: string) => void;
  onUnmarkAsPaid: (clientId: string, receivableId: string) => void;
  onDeleteReceivable: (clientId: string, receivableId: string) => void;
  onAddReceivable: (clientId: string, newRec: Omit<Receivable, 'id'>) => void;
  onAddSubscription: (clientId: string, sub: Omit<Subscription, 'id'>) => void;
  onDeleteSubscription: (clientId: string, subId: string) => void;
  onGenerateCharge: (clientId: string, subId: string) => void;
  isLoading?: boolean;
}

const ClientFinanceDrawer: React.FC<ClientFinanceDrawerProps> = ({
  client, onClose, onMarkAsPaid, onUnmarkAsPaid, onDeleteReceivable,
  onAddReceivable, onAddSubscription, onDeleteSubscription, onGenerateCharge, isLoading
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [addType, setAddType] = useState<'single' | 'recurring'>('single');
  
  // Single Charge State
  const [newRec, setNewRec] = useState({ description: '', amount: '', dueDate: '', status: 'pending' as const });
  
  // Subscription State
  const [newSub, setNewSub] = useState({ description: '', amount: '', dueDay: '' });
  
  // Simulation states
  const [boletoSimulated, setBoletoSimulated] = useState<string | null>(null);
  const [chargeGenerated, setChargeGenerated] = useState<string | null>(null);

  // Confirmation states
  const [confirmingDeleteSub, setConfirmingDeleteSub] = useState<string | null>(null);
  const [confirmingDeleteRec, setConfirmingDeleteRec] = useState<string | null>(null);
  const [confirmingUnmark, setConfirmingUnmark] = useState<string | null>(null);

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'overdue': return 'bg-red-500/10 text-red-600 border-red-500/20';
      default: return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'paid': return 'Pago';
      case 'overdue': return 'Atrasado';
      default: return 'Pendente';
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const handleCreateReceivable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRec.description || !newRec.amount || !newRec.dueDate) return;
    
    const isOverdue = new Date(newRec.dueDate) < new Date() && newRec.status !== 'paid';
    
    onAddReceivable(client.id, {
      description: newRec.description,
      amount: parseFloat(newRec.amount),
      dueDate: newRec.dueDate,
      status: isOverdue ? 'overdue' : newRec.status
    });
    
    setIsAdding(false);
    setNewRec({ description: '', amount: '', dueDate: '', status: 'pending' });
  };

  const handleCreateSubscription = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSub.description || !newSub.amount || !newSub.dueDay) return;
    
    onAddSubscription(client.id, {
      description: newSub.description,
      amount: parseFloat(newSub.amount),
      dueDay: parseInt(newSub.dueDay, 10),
      status: 'active'
    });
    
    setIsAdding(false);
    setNewSub({ description: '', amount: '', dueDay: '' });
  };

  const handleGenerateBoleto = (recId: string) => {
    setBoletoSimulated(recId);
    setTimeout(() => {
      setBoletoSimulated(null);
    }, 3000);
  };

  const triggerGenerateCharge = (subId: string) => {
    onGenerateCharge(client.id, subId);
    setChargeGenerated(subId);
    setTimeout(() => {
      setChargeGenerated(null);
    }, 3000);
  };

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[120] bg-background/80 backdrop-blur-sm flex justify-end"
      >
        <motion.div 
          onClick={(e) => e.stopPropagation()}
          initial={{ x: '100%', opacity: 0.5 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0.5 }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="bg-background border-l border-border/60 w-full max-w-2xl h-full flex flex-col shadow-2xl relative"
        >
          {/* Header */}
          <div className="p-6 md:p-8 border-b border-border/40 shrink-0 bg-secondary/10">
            <div className="flex justify-between items-start mb-6">
              <button onClick={onClose} className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-2xl shadow-sm shrink-0">
                {client.name.charAt(0)}
              </div>
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground">
                  {client.name}
                </h2>
                <div className="text-muted text-sm font-medium flex items-center gap-2 mt-1">
                  <span className="uppercase text-xs font-bold tracking-wider">{client.category || 'Sem Categoria'}</span>
                  <span>•</span>
                  <span>{client.contact}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8 space-y-8">

            {isLoading && (
              <div className="flex flex-col items-center justify-center py-10 text-muted">
                <Loader2 size={28} className="animate-spin mb-3 opacity-60" />
                <p className="text-sm font-medium">Carregando lançamentos e assinaturas...</p>
              </div>
            )}

            {/* Action Bar */}
            {!isLoading && !isAdding && (
              <div className="flex justify-end">
                <button 
                  onClick={() => setIsAdding(true)}
                  className="flex items-center gap-2 text-xs font-bold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-4 py-2.5 rounded-xl transition-colors shadow-sm"
                >
                  <Plus size={16} /> Novo Lançamento ou Assinatura
                </button>
              </div>
            )}

            {/* Add Form (Dynamic) */}
            <AnimatePresence>
              {isAdding && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-secondary/20 border border-border/60 p-5 rounded-2xl space-y-5">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm text-foreground">O que você deseja criar?</h4>
                      <div className="flex bg-background border border-border rounded-lg p-1">
                        <button 
                          onClick={() => setAddType('single')}
                          className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${addType === 'single' ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-foreground'}`}
                        >
                          Cobrança Única
                        </button>
                        <button 
                          onClick={() => setAddType('recurring')}
                          className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors flex items-center gap-1 ${addType === 'recurring' ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-foreground'}`}
                        >
                          <Repeat size={12} /> Assinatura
                        </button>
                      </div>
                    </div>

                    {addType === 'single' ? (
                      <form onSubmit={handleCreateReceivable} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-foreground/80 mb-1">Descrição</label>
                            <input required value={newRec.description} onChange={e => setNewRec({...newRec, description: e.target.value})} type="text" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="Ex: Material Didático" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1">Valor</label>
                            <input required value={newRec.amount} onChange={e => setNewRec({...newRec, amount: e.target.value})} type="number" step="0.01" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="0.00" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1">Data de Vencimento</label>
                            <input required value={newRec.dueDate} onChange={e => setNewRec({...newRec, dueDate: e.target.value})} type="date" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                        </div>
                        <div className="flex gap-3 justify-end pt-2">
                          <button type="button" onClick={() => setIsAdding(false)} className="px-4 py-2.5 rounded-xl text-xs font-bold border border-border text-foreground hover:bg-secondary transition-colors">Cancelar</button>
                          <button type="submit" className="px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold transition-colors shadow-md shadow-primary/20">Lançar Cobrança</button>
                        </div>
                      </form>
                    ) : (
                      <form onSubmit={handleCreateSubscription} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-foreground/80 mb-1">Nome da Assinatura / Plano</label>
                            <input required value={newSub.description} onChange={e => setNewSub({...newSub, description: e.target.value})} type="text" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="Ex: Mensalidade Escolar" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1">Valor Fixo</label>
                            <input required value={newSub.amount} onChange={e => setNewSub({...newSub, amount: e.target.value})} type="number" step="0.01" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="0.00" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground/80 mb-1">Dia do Vencimento (1 a 31)</label>
                            <input required value={newSub.dueDay} onChange={e => setNewSub({...newSub, dueDay: e.target.value})} type="number" min="1" max="31" className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="Ex: 5" />
                          </div>
                        </div>
                        <div className="flex gap-3 justify-end pt-2">
                          <button type="button" onClick={() => setIsAdding(false)} className="px-4 py-2.5 rounded-xl text-xs font-bold border border-border text-foreground hover:bg-secondary transition-colors">Cancelar</button>
                          <button type="submit" className="px-4 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-xs font-bold transition-colors shadow-md shadow-accent/20 flex items-center gap-1.5"><Repeat size={14}/> Criar Assinatura</button>
                        </div>
                      </form>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Subscriptions Section */}
            {!isLoading && client.subscriptions && client.subscriptions.length > 0 && (
              <div>
                <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2 mb-4">
                  <Repeat size={18} className="text-accent" /> Assinaturas Ativas
                </h3>
                <div className="space-y-3">
                  {client.subscriptions.map((sub) => (
                    <div key={sub.id} className="flex flex-col p-4 bg-accent/5 border border-accent/20 rounded-2xl relative overflow-hidden transition-colors hover:border-accent/40">
                      <div className="absolute top-0 left-0 bottom-0 w-1 bg-accent"></div>
                      
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                          <p className="font-bold text-foreground flex items-center gap-2">
                            {sub.description}
                            <span className="px-2 py-0.5 rounded-md text-[10px] uppercase font-bold bg-accent/10 text-accent">Recorrente</span>
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-sm font-bold text-foreground/80">{formatCurrency(sub.amount)}</span>
                            <span className="text-xs text-muted flex items-center gap-1"><Calendar size={12}/> Vence todo dia {sub.dueDay}</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-col items-end gap-2">
                          {chargeGenerated === sub.id ? (
                            <span className="text-xs font-bold text-green-500 flex items-center gap-1">
                              <CheckCircle2 size={14} /> Mensalidade Gerada!
                            </span>
                          ) : (
                            <button 
                              onClick={() => triggerGenerateCharge(sub.id)}
                              className="flex items-center gap-1.5 text-xs font-bold text-accent hover:text-white bg-accent/10 hover:bg-accent px-3 py-2 rounded-xl transition-all border border-accent/20 hover:border-accent shadow-sm"
                            >
                              <Zap size={14} /> Gerar Fatura do Mês
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Delete Subscription Action */}
                      <div className="flex items-center gap-2 justify-end border-t border-border/40 pt-3 mt-3">
                        {confirmingDeleteSub === sub.id ? (
                          <>
                            <span className="text-xs font-bold text-red-500 mr-auto flex items-center gap-1">Tem certeza? Isso apagará a assinatura.</span>
                            <button 
                              onClick={() => setConfirmingDeleteSub(null)}
                              className="text-xs font-bold px-3 py-1.5 text-foreground/80 hover:text-foreground bg-secondary rounded-lg transition-colors"
                            >
                              Cancelar
                            </button>
                            <motion.button 
                              initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                              onClick={() => { onDeleteSubscription(client.id, sub.id); setConfirmingDeleteSub(null); }}
                              className="flex items-center gap-1 text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                            >
                              <Trash2 size={14} /> Confirmar Exclusão
                            </motion.button>
                          </>
                        ) : (
                          <button 
                            onClick={() => setConfirmingDeleteSub(sub.id)}
                            className="flex items-center gap-1 text-xs font-bold text-red-500 hover:text-white hover:bg-red-500 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-red-500 hover:shadow-sm ml-auto"
                          >
                            <Trash2 size={14} /> Cancelar Assinatura
                          </button>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Receivables History */}
            {!isLoading && (
            <div>
              <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2 mb-4 mt-6">
                <Receipt size={18} className="text-primary/70" /> Histórico de Lançamentos
              </h3>

              <div className="space-y-3">
                {client.receivables.length > 0 ? (
                  client.receivables.sort((a,b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()).map((rec) => (
                    <div key={rec.id} className="flex flex-col p-4 bg-background border border-border/60 rounded-2xl hover:border-border transition-colors gap-4 shadow-sm relative overflow-hidden">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${rec.status === 'paid' ? 'bg-green-500/10 text-green-500' : rec.status === 'overdue' ? 'bg-red-500/10 text-red-500' : 'bg-orange-500/10 text-orange-500'}`}>
                            <DollarSign size={20} />
                          </div>
                          <div>
                            <p className="font-bold text-foreground">{rec.description}</p>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-sm font-bold text-foreground/80">{formatCurrency(rec.amount)}</span>
                              <span className="text-xs text-muted flex items-center gap-1"><Calendar size={12}/> Vence: {parseDateOnly(rec.dueDate).toLocaleDateString('pt-BR')}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] uppercase tracking-wider font-bold border flex items-center gap-1.5 ${getStatusStyle(rec.status)}`}>
                          {getStatusText(rec.status)}
                        </span>
                      </div>

                      {/* Bottom Actions Row */}
                      <div className="flex flex-wrap items-center gap-2 justify-end border-t border-border/40 pt-3 mt-1">
                        
                        {/* Simulation feedback */}
                        {boletoSimulated === rec.id && (
                          <span className="text-xs font-bold text-green-500 flex items-center gap-1 mr-auto">
                            <CheckCircle2 size={14} /> Boleto Gerado!
                          </span>
                        )}

                        <div className="flex flex-wrap items-center gap-2 ml-auto">
                          {/* Unmark as Paid Confirmation */}
                          {confirmingUnmark === rec.id ? (
                             <div className="flex items-center gap-2">
                               <button onClick={() => setConfirmingUnmark(null)} className="text-[10px] uppercase font-bold text-muted hover:text-foreground px-2 py-1">Cancelar</button>
                               <motion.button initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                                 onClick={() => { onUnmarkAsPaid(client.id, rec.id); setConfirmingUnmark(null); }}
                                 className="flex items-center gap-1 text-[10px] uppercase font-bold bg-orange-500 text-white px-3 py-1.5 rounded-lg shadow-sm"
                               >
                                 <Undo2 size={12} /> Confirmar Reversão
                               </motion.button>
                             </div>
                          ) : confirmingDeleteRec === rec.id ? (
                            /* Delete Confirmation */
                            <div className="flex items-center gap-2">
                               <button onClick={() => setConfirmingDeleteRec(null)} className="text-[10px] uppercase font-bold text-muted hover:text-foreground px-2 py-1">Cancelar</button>
                               <motion.button initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                                 onClick={() => { onDeleteReceivable(client.id, rec.id); setConfirmingDeleteRec(null); }}
                                 className="flex items-center gap-1 text-[10px] uppercase font-bold bg-red-500 text-white px-3 py-1.5 rounded-lg shadow-sm"
                               >
                                 <Trash2 size={12} /> Confirmar Exclusão
                               </motion.button>
                             </div>
                          ) : (
                            /* Standard Actions */
                            <>
                              <button 
                                onClick={() => setConfirmingDeleteRec(rec.id)}
                                className="flex items-center gap-1 text-[10px] uppercase font-bold text-red-500 hover:text-white hover:bg-red-500 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-red-500"
                              >
                                <Trash2 size={12} /> Excluir
                              </button>

                              {rec.status === 'paid' ? (
                                <button 
                                  onClick={() => setConfirmingUnmark(rec.id)}
                                  className="flex items-center gap-1 text-[10px] uppercase font-bold text-orange-500 hover:text-white hover:bg-orange-500 px-3 py-1.5 rounded-lg transition-colors border border-orange-500/30"
                                >
                                  <Undo2 size={12} /> Desfazer Pagamento
                                </button>
                              ) : (
                                <>
                                  <button 
                                    onClick={() => handleGenerateBoleto(rec.id)}
                                    className="flex items-center gap-1.5 text-xs font-bold text-foreground/80 hover:text-foreground bg-secondary/50 hover:bg-secondary px-3 py-1.5 rounded-lg transition-colors border border-border/40"
                                  >
                                    <FileText size={14} /> Gerar Boleto
                                  </button>
                                  <button 
                                    onClick={() => onMarkAsPaid(client.id, rec.id)}
                                    className="flex items-center gap-1.5 text-xs font-bold text-green-600 dark:text-green-400 hover:text-green-700 bg-green-500/10 hover:bg-green-500/20 px-3 py-1.5 rounded-lg transition-colors border border-green-500/20"
                                  >
                                    <CheckCircle2 size={14} /> Marcar Pago
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 bg-secondary/10 border border-border/40 border-dashed rounded-2xl">
                    <Receipt size={32} className="mx-auto text-muted/50 mb-3" />
                    <p className="text-sm font-bold text-foreground">Nenhuma cobrança registrada</p>
                    <p className="text-xs text-muted mt-1">Este cliente ainda não possui histórico de mensalidades ou serviços.</p>
                  </div>
                )}
              </div>
            </div>
            )}

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ClientFinanceDrawer;
