import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Filter, X, HeartHandshake, FileText, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import ClientFinanceDrawer from '../../components/ClientFinanceDrawer';
import ClientReportModal from '../../components/ClientReportModal';

export interface Receivable {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  status: 'paid' | 'pending' | 'overdue';
}

export interface Subscription {
  id: string;
  description: string;
  amount: number;
  dueDay: number;
  status: 'active' | 'inactive';
}

export interface Client {
  id: string;
  name: string;
  category: string; // e.g. "Turma A", "Bulldog Francês"
  contact: string;
  email?: string;
  status: 'active' | 'inactive';
  receivables: Receivable[];
  subscriptions: Subscription[];
}

const mockClients: Client[] = [
  {
    id: '1',
    name: 'Ana Laura (Mãe do Pedrinho)',
    category: 'Turma do Berçário',
    contact: '(11) 98765-4321',
    email: 'ana.laura@email.com',
    status: 'active',
    receivables: [
      { id: 'r1', description: 'Mensalidade Junho', amount: 850.00, dueDate: '2026-06-05', status: 'paid' },
      { id: 'r2', description: 'Material Didático', amount: 120.00, dueDate: '2026-06-15', status: 'paid' },
      { id: 'r3', description: 'Mensalidade Julho', amount: 850.00, dueDate: '2026-07-05', status: 'overdue' },
    ],
    subscriptions: [
      { id: 's1', description: 'Mensalidade Escolar', amount: 850.00, dueDay: 5, status: 'active' }
    ]
  },
  {
    id: '2',
    name: 'Carlos Mendes (Dono do Rex)',
    category: 'Cachorro - Pastor Alemão',
    contact: '(11) 91234-5678',
    status: 'active',
    receivables: [
      { id: 'r4', description: 'Banho e Tosa Mensal', amount: 150.00, dueDate: '2026-07-10', status: 'pending' },
      { id: 'r5', description: 'Vacina V10', amount: 180.00, dueDate: '2026-07-10', status: 'pending' },
    ],
    subscriptions: [
      { id: 's2', description: 'Plano Saúde Pet', amount: 99.90, dueDay: 10, status: 'active' }
    ]
  },
  {
    id: '3',
    name: 'Escola Esperança',
    category: 'Cliente Corporativo',
    contact: '(11) 3333-4444',
    email: 'financeiro@escola.com.br',
    status: 'inactive',
    receivables: [
      { id: 'r6', description: 'Consultoria Pedagógica', amount: 2500.00, dueDate: '2026-05-20', status: 'paid' },
    ],
    subscriptions: []
  }
];

const ClientsList = () => {
  const [clients, setClients] = useState<Client[]>(mockClients);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // New Client Form Modal State
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', category: '', contact: '', email: '' });

  useEffect(() => {
    if (selectedClient || isNewClientModalOpen || isReportModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedClient, isNewClientModalOpen, isReportModalOpen]);

  const filteredClients = clients.filter(c => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return c.name.toLowerCase().includes(lowerQuery) || 
           c.category.toLowerCase().includes(lowerQuery) ||
           c.contact.toLowerCase().includes(lowerQuery);
  });

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClient.name) return;

    const created: Client = {
      id: Math.random().toString(36).substring(7),
      name: newClient.name,
      category: newClient.category,
      contact: newClient.contact,
      email: newClient.email,
      status: 'active',
      receivables: [],
      subscriptions: []
    };

    setClients([created, ...clients]);
    setNewClient({ name: '', category: '', contact: '', email: '' });
    setIsNewClientModalOpen(false);
  };

  const handleMarkAsPaid = (clientId: string, receivableId: string) => {
    setClients(clients.map(c => {
      if (c.id === clientId) {
        const updatedReceivables = c.receivables.map(r => 
          r.id === receivableId ? { ...r, status: 'paid' as const } : r
        );
        const updatedClient = { ...c, receivables: updatedReceivables };
        if (selectedClient?.id === c.id) setSelectedClient(updatedClient);
        return updatedClient;
      }
      return c;
    }));
  };

  const handleUnmarkAsPaid = (clientId: string, receivableId: string) => {
    setClients(clients.map(c => {
      if (c.id === clientId) {
        const updatedReceivables = c.receivables.map(r => {
          if (r.id === receivableId) {
            const isOverdue = new Date(r.dueDate) < new Date();
            return { ...r, status: isOverdue ? 'overdue' : 'pending' as const };
          }
          return r;
        });
        const updatedClient = { ...c, receivables: updatedReceivables };
        if (selectedClient?.id === c.id) setSelectedClient(updatedClient);
        return updatedClient;
      }
      return c;
    }));
  };

  const handleDeleteReceivable = (clientId: string, receivableId: string) => {
    setClients(clients.map(c => {
      if (c.id === clientId) {
        const updatedReceivables = c.receivables.filter(r => r.id !== receivableId);
        const updatedClient = { ...c, receivables: updatedReceivables };
        if (selectedClient?.id === c.id) setSelectedClient(updatedClient);
        return updatedClient;
      }
      return c;
    }));
  };

  const handleDeleteSubscription = (clientId: string, subId: string) => {
    setClients(clients.map(c => {
      if (c.id === clientId) {
        const updatedSubs = c.subscriptions.filter(s => s.id !== subId);
        const updatedClient = { ...c, subscriptions: updatedSubs };
        if (selectedClient?.id === c.id) setSelectedClient(updatedClient);
        return updatedClient;
      }
      return c;
    }));
  };

  const handleAddReceivable = (clientId: string, newRec: Omit<Receivable, 'id'>) => {
    setClients(clients.map(c => {
      if (c.id === clientId) {
        const added = { ...newRec, id: Math.random().toString(36).substring(7) };
        const updatedClient = { ...c, receivables: [...c.receivables, added] };
        if (selectedClient?.id === c.id) setSelectedClient(updatedClient);
        return updatedClient;
      }
      return c;
    }));
  };

  const handleAddSubscription = (clientId: string, sub: Omit<Subscription, 'id'>) => {
    setClients(clients.map(c => {
      if (c.id === clientId) {
        const added = { ...sub, id: Math.random().toString(36).substring(7) };
        const updatedClient = { ...c, subscriptions: [...c.subscriptions, added] };
        if (selectedClient?.id === c.id) setSelectedClient(updatedClient);
        return updatedClient;
      }
      return c;
    }));
  };

  const handleGenerateSubscriptionCharge = (clientId: string, subId: string) => {
    setClients(clients.map(c => {
      if (c.id === clientId) {
        const sub = c.subscriptions.find(s => s.id === subId);
        if (!sub) return c;
        
        const now = new Date();
        const dueDate = new Date(now.getFullYear(), now.getMonth(), sub.dueDay);
        // if due date is in the past for this month, we just set it as is. It might be overdue soon.
        const isOverdue = dueDate < now;
        
        const newRec: Receivable = {
          id: Math.random().toString(36).substring(7),
          description: `${sub.description} (${now.toLocaleString('pt-BR', { month: 'long' })})`,
          amount: sub.amount,
          dueDate: dueDate.toISOString().split('T')[0],
          status: isOverdue ? 'overdue' : 'pending'
        };

        const updatedClient = { ...c, receivables: [...c.receivables, newRec] };
        if (selectedClient?.id === c.id) setSelectedClient(updatedClient);
        return updatedClient;
      }
      return c;
    }));
  };

  const getFinancialSummary = (receivables: Receivable[]) => {
    const overdue = receivables.filter(r => r.status === 'overdue').reduce((acc, curr) => acc + curr.amount, 0);
    const pending = receivables.filter(r => r.status === 'pending').reduce((acc, curr) => acc + curr.amount, 0);
    
    if (overdue > 0) return { label: 'Com Atrasos', color: 'text-red-500', bg: 'bg-red-500/10' };
    if (pending > 0) return { label: 'Em Aberto', color: 'text-orange-500', bg: 'bg-orange-500/10' };
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
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10 sticky top-0 z-10 backdrop-blur-md">
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Nome</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Categoria / Obs</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Contato</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Saúde Financeira</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredClients.map((client, index) => {
                      const summary = getFinancialSummary(client.receivables);
                      return (
                        <motion.tr 
                          key={client.id} 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2, delay: index * 0.03 }}
                          onClick={() => setSelectedClient(client)}
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
                          <td className="px-8 py-5 text-right">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${summary.bg} ${summary.color} border-${summary.color.split('-')[1]}-500/20`}>
                              {summary.label === 'Em Dia' && <CheckCircle2 size={14} />}
                              {summary.label === 'Com Atrasos' && <AlertCircle size={14} />}
                              {summary.label === 'Em Aberto' && <Clock size={14} />}
                              {summary.label}
                            </span>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                  
                  {filteredClients.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-8 py-16 text-center text-muted">
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
                  <button type="submit" className="flex-1 py-3 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-md shadow-primary/20">Cadastrar</button>
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
        />,
        document.body
      )}

      {/* Report Modal */}
      {isReportModalOpen && createPortal(
        <ClientReportModal 
          clients={clients} 
          onClose={() => setIsReportModalOpen(false)} 
        />,
        document.body
      )}
    </div>
  );
};

export default ClientsList;
