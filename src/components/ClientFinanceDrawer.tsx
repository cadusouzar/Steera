import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, DollarSign, Calendar, CheckCircle2, Plus, Receipt, FileText, Repeat, Zap, Trash2, Undo2, Loader2, Edit2, Save, RotateCcw } from 'lucide-react';
import type { Client, Receivable, Subscription } from '../pages/app/ClientsList';
import CustomFieldsFormSection from './CustomFieldsFormSection';
import { inputBorderClass, isValidEmail } from '../lib/validation';
import { useCan } from '../lib/auth';

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
  onGenerateCharge: (clientId: string, subId: string) => Promise<boolean> | void;
  isLoading?: boolean;
  actionError?: string | null;
  onDismissError?: () => void;
  onUpdateClient: (
    clientId: string,
    dto: Partial<{ name: string; category: string; contact: string; email: string | null; customFields: Record<string, unknown> }>,
  ) => Promise<boolean>;
  onDeactivateClient: (clientId: string, includeInRevenueReport: boolean) => Promise<boolean>;
  // Only ever offered for a client kept in the report (includeInRevenueReport
  // =true) — those stay reachable/inactive forever with no other UI path back
  // to active. A client removed from the report goes through the Lixeira's
  // own restore flow instead.
  onRestoreClient: (clientId: string) => Promise<boolean>;
}

const ClientFinanceDrawer: React.FC<ClientFinanceDrawerProps> = ({
  client, onClose, onMarkAsPaid, onUnmarkAsPaid, onDeleteReceivable,
  onAddReceivable, onAddSubscription, onDeleteSubscription, onGenerateCharge, isLoading,
  actionError, onDismissError, onUpdateClient, onDeactivateClient, onRestoreClient
}) => {
  // Permissões por ação (27/09/2026): editar/excluir/reativar o cliente exige `clientes.gerenciar`;
  // ver lançamentos/assinaturas exige `financas.lancamentos.ver`; criar/pagar/desfazer/excluir/gerar
  // fatura exige `financas.lancamentos.gerenciar`. Sem a permissão, o botão nem aparece.
  const can = useCan();
  const canManageClient = can('clientes.gerenciar');
  const canViewFinance = can('financas.lancamentos.ver');
  const canManageFinance = can('financas.lancamentos.gerenciar');
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

  // Client edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<{ name: string; category: string; contact: string; email: string }>>({});
  const [editCustomFields, setEditCustomFields] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [editEmailError, setEditEmailError] = useState<string>();

  // Client "delete" (inactivate) state — a confirmation modal, not an inline
  // toggle, because the user must pick one of two mutually exclusive options
  // (keep vs. remove from the revenue report), not just confirm/cancel.
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // "Assinaturas Ativas" deve mostrar só o que ainda está ativo — uma assinatura
  // pausada (ex.: cliente inativado, que pausa as assinaturas dele) não deve
  // continuar aparecendo com botão de gerar fatura/cancelar como se estivesse
  // em vigor.
  const activeSubscriptions = client.subscriptions?.filter((sub) => sub.status === 'active') ?? [];

  const handleEditClick = () => {
    setEditForm({ name: client.name, category: client.category, contact: client.contact, email: client.email ?? '' });
    setEditCustomFields(client.customFields ?? {});
    setEditEmailError(undefined);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!editForm.name || !editForm.contact) return;
    const emailErr = editForm.email && !isValidEmail(editForm.email) ? 'E-mail inválido' : undefined;
    setEditEmailError(emailErr);
    if (emailErr) return;
    setIsSaving(true);
    // `null` explícito (nunca string vazia) pra limpar o e-mail — o backend só aceita "sem
    // e-mail" como null/undefined, uma string vazia ainda cai na validação de formato e
    // vazava um erro técnico cru pro usuário (achado durante a auditoria de segurança).
    const ok = await onUpdateClient(client.id, { ...editForm, email: editForm.email || null, customFields: editCustomFields });
    setIsSaving(false);
    if (ok) setIsEditing(false);
  };

  const handleConfirmDeactivate = async (includeInRevenueReport: boolean) => {
    if (isDeactivating) return; // avoid duplicate submits from a double-click
    setIsDeactivating(true);
    await onDeactivateClient(client.id, includeInRevenueReport);
    setIsDeactivating(false);
    // Always close: on success the drawer itself closes (parent clears
    // selectedClient); on failure the drawer's actionError banner explains
    // what happened, so a dangling modal isn't needed either way.
    setIsDeactivateModalOpen(false);
  };

  const handleRestore = async () => {
    if (isRestoring) return; // avoid duplicate submits from a double-click
    setIsRestoring(true);
    await onRestoreClient(client.id);
    setIsRestoring(false);
  };

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
    
    const isOverdue = new Date(newRec.dueDate) < new Date();
    
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

  const triggerGenerateCharge = async (subId: string) => {
    const succeeded = await onGenerateCharge(client.id, subId);
    if (succeeded === false) return; // e.g. "already generated this month" — error shown above, don't flash success
    setChargeGenerated(subId);
    setTimeout(() => {
      setChargeGenerated(null);
    }, 3000);
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Best-effort UI hint only — the backend is still the source of truth (a 409
  // from onGenerateCharge is handled above regardless of this check).
  const hasChargeThisMonth = (subscriptionId: string) =>
    client.receivables.some(
      (r) => r.subscriptionId === subscriptionId && r.referenceYear === currentYear && r.referenceMonth === currentMonth,
    );

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
              {!isEditing && !isLoading && canManageClient ? (
                <button onClick={handleEditClick} className="p-2 text-primary hover:text-primary bg-primary/10 hover:bg-primary/20 rounded-full transition-colors" title="Editar Cliente">
                  <Edit2 size={18} />
                </button>
              ) : <div />}
              <button onClick={onClose} className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-2xl shadow-sm shrink-0">
                {(isEditing ? editForm.name : client.name)?.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.name ?? ''}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full bg-background border border-border/80 rounded-lg px-3 py-1.5 text-2xl font-heading font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                    placeholder="Nome Completo"
                  />
                ) : (
                  <h2 className="text-2xl font-heading font-bold text-foreground truncate flex items-center gap-2">
                    {client.name}
                    {client.status === 'inactive' && (
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-secondary text-muted border border-border/60">Inativo</span>
                    )}
                  </h2>
                )}

                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.category ?? ''}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                    className="mt-2 w-full bg-background border border-border/80 rounded-lg px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                    placeholder="Categoria / Observação"
                  />
                ) : (
                  <div className="text-muted text-sm font-medium flex items-center gap-2 mt-1">
                    <span className="uppercase text-xs font-bold tracking-wider">{client.category || 'Sem Categoria'}</span>
                    <span>•</span>
                    <span>{client.contact}</span>
                  </div>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-5">
                <div>
                  <label className="block text-xs font-medium text-foreground/80 mb-1.5">Telefone/Contato</label>
                  <input
                    type="text"
                    value={editForm.contact ?? ''}
                    onChange={(e) => setEditForm({ ...editForm, contact: e.target.value })}
                    className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground/80 mb-1.5">E-mail</label>
                  <input
                    type="email"
                    value={editForm.email ?? ''}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    onBlur={() => setEditEmailError(editForm.email && !isValidEmail(editForm.email) ? 'E-mail inválido' : undefined)}
                    className={`w-full bg-background border ${inputBorderClass(!!editEmailError)} rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-colors`}
                  />
                  {editEmailError && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{editEmailError}</p>}
                </div>
                <div className="sm:col-span-2">
                  <CustomFieldsFormSection entity="client" values={editCustomFields} onChange={setEditCustomFields} />
                </div>
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8 space-y-8">

            {actionError && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm font-medium">
                <span>{actionError}</span>
                <button onClick={onDismissError} className="text-red-600 hover:text-red-700 shrink-0">
                  <X size={16} />
                </button>
              </div>
            )}

            {isLoading && (
              <div className="flex flex-col items-center justify-center py-10 text-muted">
                <Loader2 size={28} className="animate-spin mb-3 opacity-60" />
                <p className="text-sm font-medium">Carregando lançamentos e assinaturas...</p>
              </div>
            )}

            {!isLoading && !canViewFinance && (
              <div className="text-center py-10 bg-secondary/10 border border-border/40 border-dashed rounded-2xl">
                <Receipt size={32} className="mx-auto text-muted/50 mb-3" />
                <p className="text-sm font-bold text-foreground">Lançamentos indisponíveis</p>
                <p className="text-xs text-muted mt-1">Seu perfil não permite ver os lançamentos e assinaturas deste cliente.</p>
              </div>
            )}

            {/* Action Bar */}
            {!isLoading && !isAdding && canManageFinance && (
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
                          className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${addType === 'single' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}
                        >
                          Cobrança Única
                        </button>
                        <button 
                          onClick={() => setAddType('recurring')}
                          className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors flex items-center gap-1 ${addType === 'recurring' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}
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
                          <button type="submit" className="px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs font-bold transition-colors shadow-md shadow-primary/20">Lançar Cobrança</button>
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
                          <button type="submit" className="px-4 py-2.5 bg-accent hover:bg-accent/90 text-primary-foreground rounded-xl text-xs font-bold transition-colors shadow-md shadow-accent/20 flex items-center gap-1.5"><Repeat size={14}/> Criar Assinatura</button>
                        </div>
                      </form>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Subscriptions Section */}
            {!isLoading && canViewFinance && activeSubscriptions.length > 0 && (
              <div>
                <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2 mb-4">
                  <Repeat size={18} className="text-accent" /> Assinaturas Ativas
                </h3>
                <div className="space-y-3">
                  {activeSubscriptions.map((sub) => (
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
                          ) : hasChargeThisMonth(sub.id) ? (
                            <span className="flex items-center gap-1.5 text-xs font-bold text-muted bg-secondary/50 px-3 py-2 rounded-xl border border-border/40">
                              <CheckCircle2 size={14} /> Fatura deste mês já gerada
                            </span>
                          ) : canManageFinance && (
                            <button
                              onClick={() => triggerGenerateCharge(sub.id)}
                              className="flex items-center gap-1.5 text-xs font-bold text-accent hover:text-primary-foreground bg-accent/10 hover:bg-accent px-3 py-2 rounded-xl transition-all border border-accent/20 hover:border-accent shadow-sm"
                            >
                              <Zap size={14} /> Gerar Fatura do Mês
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Delete Subscription Action */}
                      {canManageFinance && (
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
                      )}

                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Receivables History */}
            {!isLoading && canViewFinance && (
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
                          ) : canManageFinance && (
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

          {/* Footer: edit actions, or the delete button — mutually exclusive with editing */}
          <AnimatePresence>
            {isEditing ? (
              <motion.div
                key="edit-footer"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="p-6 md:p-8 border-t border-border/40 bg-background/80 backdrop-blur-md shrink-0 flex gap-3"
              >
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSaving}
                  className="flex-1 py-3.5 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                >
                  <Save size={18} />
                  {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </motion.div>
            ) : (
              !isLoading && canManageClient && client.status === 'active' && (
                <motion.div
                  key="delete-footer"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="p-6 md:p-8 border-t border-border/40 bg-secondary/10 shrink-0 flex items-center justify-between gap-4"
                >
                  <button
                    onClick={() => setIsDeactivateModalOpen(true)}
                    className="px-5 py-3.5 rounded-xl font-medium text-red-500 hover:bg-red-500/10 transition-colors text-sm flex items-center gap-2"
                  >
                    <Trash2 size={16} />
                    Excluir Cliente
                  </button>
                </motion.div>
              )
            )}
            {!isEditing && !isLoading && canManageClient && client.status === 'inactive' && (
              <motion.div
                key="restore-footer"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="p-6 md:p-8 border-t border-border/40 bg-secondary/10 shrink-0 flex items-center justify-between gap-4"
              >
                <span className="text-xs text-muted">
                  Cliente inativo — os dados de faturamento continuam nos relatórios.
                </span>
                <button
                  onClick={handleRestore}
                  disabled={isRestoring}
                  className="px-5 py-3.5 rounded-xl font-bold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-60 transition-colors text-sm flex items-center gap-2 shadow-lg shadow-primary/20"
                >
                  <RotateCcw size={16} />
                  {isRestoring ? 'Reativando...' : 'Reativar Cliente'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* Confirmation modal: two mutually exclusive choices, not a browser confirm() */}
      {isDeactivateModalOpen && (
        <motion.div
          key="deactivate-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !isDeactivating && setIsDeactivateModalOpen(false)}
          className="fixed inset-0 z-[130] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-500 to-orange-500 opacity-80" />
            <div className="flex items-center justify-between mb-6 mt-2">
              <h2 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
                <Trash2 className="text-red-500" size={22} />
                Excluir Cliente
              </h2>
              <button
                onClick={() => setIsDeactivateModalOpen(false)}
                disabled={isDeactivating}
                className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-foreground/90 mb-4">
              <strong>{client.name}</strong> será marcado como inativo. Se optar por mantê-lo nos relatórios, o cadastro e todo o histórico de lançamentos continuam salvos — nada é apagado.
            </p>
            <p className="text-sm font-semibold text-foreground mb-6">
              Deseja manter os dados de faturamento deste cliente nos relatórios?
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleConfirmDeactivate(true)}
                disabled={isDeactivating}
                className="w-full py-3.5 rounded-xl font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 text-sm"
              >
                {isDeactivating ? 'Processando...' : 'Sim, manter nos relatórios'}
              </button>
              <div>
                <button
                  onClick={() => handleConfirmDeactivate(false)}
                  disabled={isDeactivating}
                  className="w-full py-3.5 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 disabled:opacity-60 text-sm"
                >
                  {isDeactivating ? 'Processando...' : 'Não, remover dos relatórios'}
                </button>
                <p className="text-xs text-muted mt-1.5 px-1">
                  Vai para a Lixeira e é excluído permanentemente após 30 dias (é possível restaurar até lá).
                </p>
              </div>
              <button
                onClick={() => setIsDeactivateModalOpen(false)}
                disabled={isDeactivating}
                className="w-full py-3 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ClientFinanceDrawer;
