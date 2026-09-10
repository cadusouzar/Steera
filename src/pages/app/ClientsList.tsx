import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Filter, X, HeartHandshake, FileText, CheckCircle2, AlertCircle, Clock, Loader2, ChevronRight, Trash2 } from 'lucide-react';
import ClientFinanceDrawer from '../../components/ClientFinanceDrawer';
import ClientReportModal from '../../components/ClientReportModal';
import ClientTrashDrawer from '../../components/ClientTrashDrawer';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import * as api from '../../lib/api';
import type { ClientRecord, ClientTotals } from '../../lib/api';

export type { Receivable, Subscription } from '../../lib/api';
import type { Receivable, Subscription } from '../../lib/api';

export interface Client extends ClientRecord {
  receivables: Receivable[];
  subscriptions: Subscription[];
}

const EMPTY_TOTALS: ClientTotals = { totalPaid: 0, totalPending: 0, totalOverdue: 0 };

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const ClientsList = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [totalsByClientId, setTotalsByClientId] = useState<Record<string, ClientTotals>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isDrawerLoading, setIsDrawerLoading] = useState(false);

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);

  // New Client Form Modal State
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', category: '', contact: '', email: '' });
  const [isCreating, setIsCreating] = useState(false);

  useEscapeKey(() => {
    setSelectedClient(null);
    setIsNewClientModalOpen(false);
    setIsReportModalOpen(false);
    setIsTrashOpen(false);
  });

  useEffect(() => {
    if (selectedClient || isNewClientModalOpen || isReportModalOpen || isTrashOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedClient, isNewClientModalOpen, isReportModalOpen, isTrashOpen]);

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const basics = await api.listClients();
      setClients(basics.map((c) => ({ ...c, receivables: [], subscriptions: [] })));

      const totalsEntries = await Promise.all(
        basics.map(async (c) => [c.id, await api.getClientTotals(c.id).catch(() => EMPTY_TOTALS)] as const),
      );
      setTotalsByClientId(Object.fromEntries(totalsEntries));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os clientes.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const filteredClients = clients.filter(c => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return c.name.toLowerCase().includes(lowerQuery) ||
           c.category.toLowerCase().includes(lowerQuery) ||
           c.contact.toLowerCase().includes(lowerQuery);
  });

  // Re-fetches one client's receivables/subscriptions/totals and syncs them
  // into both the open drawer (if it's this client) and the totals used by
  // the table's health badge.
  const refreshClientDetails = async (clientId: string) => {
    const [receivables, subscriptions, totals] = await Promise.all([
      api.listReceivables(clientId),
      api.listSubscriptions(clientId),
      api.getClientTotals(clientId).catch(() => EMPTY_TOTALS),
    ]);

    setTotalsByClientId(prev => ({ ...prev, [clientId]: totals }));
    setSelectedClient(prev => (prev && prev.id === clientId ? { ...prev, receivables, subscriptions } : prev));
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClient.name || isCreating) return;

    setIsCreating(true);
    setActionError(null);
    try {
      const created = await api.createClient({
        name: newClient.name,
        category: newClient.category || undefined,
        contact: newClient.contact,
        email: newClient.email || undefined,
      });
      setClients(prev => [{ ...created, receivables: [], subscriptions: [] }, ...prev]);
      setTotalsByClientId(prev => ({ ...prev, [created.id]: EMPTY_TOTALS }));
      setNewClient({ name: '', category: '', contact: '', email: '' });
      setIsNewClientModalOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível criar o cliente.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelectClient = async (client: Client) => {
    setSelectedClient(client);
    setActionError(null);
    setIsDrawerLoading(true);
    try {
      const [receivables, subscriptions] = await Promise.all([
        api.listReceivables(client.id),
        api.listSubscriptions(client.id),
      ]);
      setSelectedClient(prev => (prev && prev.id === client.id ? { ...prev, receivables, subscriptions } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível carregar os dados do cliente.');
    } finally {
      setIsDrawerLoading(false);
    }
  };

  const handleUpdateClient = async (
    clientId: string,
    dto: Partial<{ name: string; category: string; contact: string; email: string }>,
  ): Promise<boolean> => {
    try {
      const updated = await api.updateClient(clientId, dto);
      setClients(prev => prev.map(c => (c.id === clientId ? { ...c, ...updated } : c)));
      setSelectedClient(prev => (prev && prev.id === clientId ? { ...prev, ...updated } : prev));
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar as alterações do cliente.');
      return false;
    }
  };

  // "Excluir Cliente" na UI — exclusão lógica (inativa o cliente; não existe
  // hard delete no backend de propósito, pra preservar o histórico financeiro).
  // A listagem padrão só traz clientes ativos, então um cliente inativado some
  // da tabela local também — não fica só "atualizado", é removido da view.
  const handleDeactivateClient = async (clientId: string, includeInRevenueReport: boolean): Promise<boolean> => {
    try {
      await api.deactivateClient(clientId, includeInRevenueReport);
      setClients(prev => prev.filter(c => c.id !== clientId));
      setTotalsByClientId(prev => {
        const next = { ...prev };
        delete next[clientId];
        return next;
      });
      setSelectedClient(null);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível excluir o cliente.');
      return false;
    }
  };

  const handleMarkAsPaid = async (_clientId: string, receivableId: string) => {
    try {
      await api.payReceivable(receivableId);
      await refreshClientDetails(_clientId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível marcar o lançamento como pago.');
    }
  };

  const handleUnmarkAsPaid = async (_clientId: string, receivableId: string) => {
    try {
      await api.unpayReceivable(receivableId);
      await refreshClientDetails(_clientId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível desfazer o pagamento.');
    }
  };

  const handleDeleteReceivable = async (_clientId: string, receivableId: string) => {
    try {
      await api.deleteReceivable(receivableId);
      await refreshClientDetails(_clientId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível excluir o lançamento.');
    }
  };

  const handleDeleteSubscription = async (clientId: string, subId: string) => {
    try {
      await api.deleteSubscription(subId);
      await refreshClientDetails(clientId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível excluir a assinatura.');
    }
  };

  const handleAddReceivable = async (clientId: string, newRec: Omit<Receivable, 'id'>) => {
    try {
      await api.createReceivable(clientId, {
        description: newRec.description,
        amount: newRec.amount,
        dueDate: newRec.dueDate,
      });
      await refreshClientDetails(clientId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível lançar a cobrança.');
    }
  };

  const handleAddSubscription = async (clientId: string, sub: Omit<Subscription, 'id'>) => {
    try {
      await api.createSubscription(clientId, {
        description: sub.description,
        amount: sub.amount,
        dueDay: sub.dueDay,
      });
      await refreshClientDetails(clientId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível criar a assinatura.');
    }
  };

  const handleGenerateSubscriptionCharge = async (clientId: string, subId: string): Promise<boolean> => {
    try {
      await api.generateCharge(subId);
      await refreshClientDetails(clientId);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível gerar a fatura do mês.');
      return false;
    }
  };

  const getHealthBadge = (totals: ClientTotals) => {
    if (totals.totalOverdue > 0) return { label: 'Com Atrasos', color: 'text-red-500', bg: 'bg-red-500/10' };
    if (totals.totalPending > 0) return { label: 'Em Aberto', color: 'text-orange-500', bg: 'bg-orange-500/10' };
    return { label: 'Em Dia', color: 'text-green-500', bg: 'bg-green-500/10' };
  };

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground">Clientes & Recebimentos</h1>
          <p className="text-muted mt-1">Gerencie mensalidades, serviços e recebimentos em aberto.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsReportModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/80 text-foreground font-medium hover:bg-secondary transition-colors shadow-sm text-sm"
          >
            <FileText size={16} />
            Relatórios
          </button>
          <button
            onClick={() => setIsTrashOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/80 text-foreground font-medium hover:bg-secondary transition-colors shadow-sm text-sm"
          >
            <Trash2 size={16} />
            Lixeira
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsNewClientModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 text-sm"
          >
            <Plus size={18} />
            Novo Cliente
          </motion.button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm font-medium flex items-center justify-between shrink-0">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-600 hover:text-red-700">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="bg-panel border border-border rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-secondary/30 shrink-0">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input
              type="text"
              placeholder="Buscar por nome, contato ou categoria..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-background border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground shadow-sm transition-all"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border/80 text-foreground bg-background hover:bg-secondary transition-colors text-sm font-medium shadow-sm">
              <Filter size={16} />
              Filtros
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-hidden relative">
          <div className="absolute inset-0 overflow-auto custom-scrollbar">
            <div className="overflow-x-auto min-h-full">
              <table className="w-full text-left border-collapse min-w-[1400px]">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10 sticky top-0 z-10 backdrop-blur-md">
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Nome</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Categoria / Obs</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Contato</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Total Gerado</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Total Pago</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Total Pendente</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Total Faltante</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Saúde Financeira</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {isLoading && (
                    <tr>
                      <td colSpan={9} className="px-8 py-16 text-center text-muted">
                        <Loader2 size={28} className="mx-auto animate-spin mb-3 opacity-60" />
                        <p className="text-sm font-medium">Carregando clientes...</p>
                      </td>
                    </tr>
                  )}

                  {!isLoading && loadError && (
                    <tr>
                      <td colSpan={9} className="px-8 py-16 text-center text-red-500">
                        <AlertCircle size={32} className="mx-auto mb-3" />
                        <p className="text-sm font-bold">{loadError}</p>
                        <button
                          onClick={() => loadClients()}
                          className="mt-3 text-xs font-bold underline hover:text-red-600"
                        >
                          Tentar novamente
                        </button>
                      </td>
                    </tr>
                  )}

                  {!isLoading && !loadError && (
                    <AnimatePresence>
                      {filteredClients.map((client, index) => {
                        const totals = totalsByClientId[client.id] ?? EMPTY_TOTALS;
                        const summary = getHealthBadge(totals);
                        const totalGenerated = totals.totalPaid + totals.totalPending + totals.totalOverdue;
                        const totalOutstanding = totals.totalPending + totals.totalOverdue;
                        return (
                          <motion.tr
                            key={client.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2, delay: index * 0.03 }}
                            onClick={() => handleSelectClient(client)}
                            className="hover:bg-secondary/40 transition-colors group cursor-pointer"
                          >
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-sm shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                                  {client.name.charAt(0)}
                                </div>
                                <div>
                                  <span className="text-base font-heading font-bold text-foreground group-hover:text-primary transition-colors block">
                                    {client.name}
                                  </span>
                                  {client.email && <span className="text-xs text-muted font-medium">{client.email}</span>}
                                </div>
                              </div>
                            </td>
                            <td className="px-8 py-5 text-muted font-medium">{client.category || '-'}</td>
                            <td className="px-8 py-5 text-muted font-medium">{client.contact}</td>
                            <td className="px-8 py-5 text-right font-medium text-foreground">{formatCurrency(totalGenerated)}</td>
                            <td className="px-8 py-5 text-right font-medium text-green-600 dark:text-green-400">{formatCurrency(totals.totalPaid)}</td>
                            <td className="px-8 py-5 text-right font-medium text-orange-500">{formatCurrency(totals.totalPending)}</td>
                            <td className="px-8 py-5 text-right font-medium text-red-500">{formatCurrency(totalOutstanding)}</td>
                            <td className="px-8 py-5 text-right">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${summary.bg} ${summary.color} border-${summary.color.split('-')[1]}-500/20`}>
                                {summary.label === 'Em Dia' && <CheckCircle2 size={14} />}
                                {summary.label === 'Com Atrasos' && <AlertCircle size={14} />}
                                {summary.label === 'Em Aberto' && <Clock size={14} />}
                                {summary.label}
                              </span>
                            </td>
                            <td className="px-8 py-5 text-right">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSelectClient(client); }}
                                className="inline-flex items-center gap-1 text-sm font-medium text-muted group-hover:text-primary transition-colors hover:bg-secondary px-4 py-2 rounded-xl"
                              >
                                Detalhes
                                <ChevronRight size={16} />
                              </button>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  )}

                  {!isLoading && !loadError && filteredClients.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-8 py-16 text-center text-muted">
                        <div className="flex flex-col items-center justify-center">
                          <HeartHandshake size={48} className="opacity-20 mb-4" />
                          <p className="text-lg font-medium">Nenhum cliente encontrado.</p>
                          <p className="text-sm mt-1">Tente ajustar seus filtros de busca.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* New Client Modal */}
      <AnimatePresence>
        {isNewClientModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsNewClientModalOpen(false)}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex justify-center items-center p-4"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-background border border-border/60 rounded-3xl w-full max-w-md flex flex-col shadow-2xl relative overflow-hidden"
            >
              <div className="p-6 border-b border-border flex items-center justify-between">
                <h2 className="text-xl font-heading font-bold text-foreground">Novo Cliente</h2>
                <button onClick={() => setIsNewClientModalOpen(false)} className="p-2 text-muted hover:text-foreground rounded-full hover:bg-secondary transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateClient} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1.5">Nome Completo</label>
                  <input required value={newClient.name} onChange={e => setNewClient({...newClient, name: e.target.value})} type="text" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="Ex: Ana Laura / Rex" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1.5">Categoria / Observação</label>
                  <input value={newClient.category} onChange={e => setNewClient({...newClient, category: e.target.value})} type="text" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="Ex: Turma A / Pastor Alemão" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1.5">Telefone/Contato</label>
                  <input required value={newClient.contact} onChange={e => setNewClient({...newClient, contact: e.target.value})} type="text" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="(00) 00000-0000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1.5">E-mail (Opcional)</label>
                  <input value={newClient.email} onChange={e => setNewClient({...newClient, email: e.target.value})} type="email" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="email@exemplo.com" />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsNewClientModalOpen(false)} className="flex-1 py-3 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm">Cancelar</button>
                  <button type="submit" disabled={isCreating} className="flex-1 py-3 bg-primary hover:bg-primary/90 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-colors shadow-md shadow-primary/20">
                    {isCreating ? 'Cadastrando...' : 'Cadastrar'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Finance Drawer Component */}
      {selectedClient && createPortal(
        <ClientFinanceDrawer
          client={selectedClient}
          onClose={() => setSelectedClient(null)}
          onMarkAsPaid={handleMarkAsPaid}
          onUnmarkAsPaid={handleUnmarkAsPaid}
          onDeleteReceivable={handleDeleteReceivable}
          onAddReceivable={handleAddReceivable}
          onAddSubscription={handleAddSubscription}
          onDeleteSubscription={handleDeleteSubscription}
          onGenerateCharge={handleGenerateSubscriptionCharge}
          isLoading={isDrawerLoading}
          actionError={actionError}
          onDismissError={() => setActionError(null)}
          onUpdateClient={handleUpdateClient}
          onDeactivateClient={handleDeactivateClient}
        />,
        document.body
      )}

      {/* Report Modal */}
      {isReportModalOpen && createPortal(
        <ClientReportModal
          onClose={() => setIsReportModalOpen(false)}
        />,
        document.body
      )}

      {/* Client Trash Drawer */}
      {isTrashOpen && createPortal(
        <ClientTrashDrawer
          onClose={() => setIsTrashOpen(false)}
          onRestored={loadClients}
        />,
        document.body
      )}
    </div>
  );
};

export default ClientsList;
