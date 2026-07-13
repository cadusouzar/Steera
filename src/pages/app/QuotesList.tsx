import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Search, Plus, Filter, FileText, CheckCircle2, AlertCircle, XCircle, X, Edit2, Trash2, DollarSign, Calculator, Printer, HandCoins, Package } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export interface QuoteItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  type: 'product' | 'labor';
}

export interface Quote {
  id: string;
  clientName: string;
  date: string;
  items: QuoteItem[];
  discount: number;
  discountType: 'percentage' | 'fixed';
  paymentMethod: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string;
}

const mockQuotes: Quote[] = [
  {
    id: '1',
    clientName: 'TechNova Soluções',
    date: '2023-11-15',
    items: [
      { id: '1', name: 'Notebook Dell XPS 13', quantity: 2, unitPrice: 7500, type: 'product' },
      { id: '2', name: 'Formatação e Instalação', quantity: 2, unitPrice: 250, type: 'labor' }
    ],
    discount: 500,
    discountType: 'fixed',
    paymentMethod: 'Pix (À vista)',
    status: 'approved',
    notes: 'Cliente solicitou entrega expressa.'
  },
  {
    id: '2',
    clientName: 'Clínica Sorriso',
    date: '2023-11-18',
    items: [
      { id: '3', name: 'Monitor LG UltraWide', quantity: 1, unitPrice: 1200, type: 'product' },
      { id: '4', name: 'Suporte de TI Mensal', quantity: 1, unitPrice: 1500, type: 'labor' }
    ],
    discount: 10,
    discountType: 'percentage',
    paymentMethod: 'Boleto 30/60',
    status: 'pending',
    notes: 'Aguardando aprovação da diretoria.'
  }
];

const QuotesList = () => {
  const [quotes, setQuotes] = useState<Quote[]>(mockQuotes);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Quote>>({});

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newQuote, setNewQuote] = useState<Partial<Quote>>({
    clientName: '', date: new Date().toISOString().split('T')[0], items: [], discount: 0, discountType: 'fixed', paymentMethod: 'Pix', status: 'pending', notes: ''
  });

  useEscapeKey(() => {
    setSelectedQuote(null);
    setIsNewModalOpen(false);
  });

  const filteredQuotes = quotes.filter(q => {
    if (!searchQuery) return true;
    return q.clientName.toLowerCase().includes(searchQuery.toLowerCase()) || 
           q.id.includes(searchQuery);
  });

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const calculateSubtotal = (items: QuoteItem[] = []) => {
    return items.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
  };

  const calculateTotal = (quote: Partial<Quote>) => {
    const sub = calculateSubtotal(quote.items);
    if (!quote.discount) return sub;
    if (quote.discountType === 'percentage') {
      return sub - (sub * (quote.discount / 100));
    }
    return Math.max(0, sub - quote.discount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return { label: 'Aprovado', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20', icon: CheckCircle2 };
      case 'rejected': return { label: 'Rejeitado', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: XCircle };
      default: return { label: 'Pendente', color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20', icon: AlertCircle };
    }
  };

  const handleCreateQuote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQuote.clientName) return;
    
    const created: Quote = {
      id: crypto.randomUUID().slice(0, 8).toUpperCase(),
      clientName: newQuote.clientName,
      date: newQuote.date || new Date().toISOString().split('T')[0],
      items: newQuote.items || [],
      discount: newQuote.discount || 0,
      discountType: newQuote.discountType as 'percentage' | 'fixed',
      paymentMethod: newQuote.paymentMethod || 'Pix',
      status: newQuote.status as 'pending' | 'approved' | 'rejected',
      notes: newQuote.notes || ''
    };

    setQuotes([created, ...quotes]);
    setIsNewModalOpen(false);
    setNewQuote({ clientName: '', date: new Date().toISOString().split('T')[0], items: [], discount: 0, discountType: 'fixed', paymentMethod: 'Pix', status: 'pending', notes: '' });
  };

  const handleUpdateQuote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.clientName) return;

    setQuotes(quotes.map(q => q.id === editForm.id ? editForm as Quote : q));
    setSelectedQuote(null);
    setIsEditing(false);
  };

  const handleDeleteQuote = (id: string) => {
    setQuotes(quotes.filter(q => q.id !== id));
    setSelectedQuote(null);
    setIsEditing(false);
  };

  // Add Item Logic for Drawer
  const handleAddItem = (type: 'product' | 'labor', formState: Partial<Quote>, setFormState: React.Dispatch<React.SetStateAction<Partial<Quote>>>) => {
    const newItem: QuoteItem = {
      id: crypto.randomUUID(),
      name: '',
      quantity: 1,
      unitPrice: 0,
      type
    };
    setFormState({ ...formState, items: [...(formState.items || []), newItem] });
  };

  const handleUpdateItem = (itemId: string, field: keyof QuoteItem, value: any, formState: Partial<Quote>, setFormState: React.Dispatch<React.SetStateAction<Partial<Quote>>>) => {
    const updatedItems = (formState.items || []).map(item => {
      if (item.id === itemId) {
        return { ...item, [field]: value };
      }
      return item;
    });
    setFormState({ ...formState, items: updatedItems });
  };

  const handleDeleteItem = (itemId: string, formState: Partial<Quote>, setFormState: React.Dispatch<React.SetStateAction<Partial<Quote>>>) => {
    setFormState({ ...formState, items: (formState.items || []).filter(i => i.id !== itemId) });
  };

  const handlePrint = () => {
    window.print();
  };

  // Drawer Content Generator
  const renderDrawerForm = (formState: Partial<Quote>, setFormState: React.Dispatch<React.SetStateAction<Partial<Quote>>>, isEditMode: boolean) => {
    const products = (formState.items || []).filter(i => i.type === 'product');
    const labor = (formState.items || []).filter(i => i.type === 'labor');
    
    return (
      <div className="space-y-8 pb-10">
        
        {/* Client & Status Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Cliente</label>
            <input 
              type="text" 
              value={formState.clientName || ''}
              onChange={(e) => setFormState({...formState, clientName: e.target.value})}
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary text-foreground"
              placeholder="Nome do cliente"
              required
              disabled={!isEditMode && !!selectedQuote}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Data</label>
              <input 
                type="date" 
                value={formState.date || ''}
                onChange={(e) => setFormState({...formState, date: e.target.value})}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary text-foreground"
                disabled={!isEditMode && !!selectedQuote}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Status</label>
              <select 
                value={formState.status || 'pending'}
                onChange={(e) => setFormState({...formState, status: e.target.value as any})}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary text-foreground"
                disabled={!isEditMode && !!selectedQuote}
              >
                <option value="pending">Pendente</option>
                <option value="approved">Aprovado</option>
                <option value="rejected">Rejeitado</option>
              </select>
            </div>
          </div>
        </div>

        {/* Products Section */}
        <div className="bg-secondary/10 border border-border rounded-2xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Package size={16} className="text-primary" /> Peças / Produtos
            </h3>
            {(!selectedQuote || isEditMode) && (
              <button 
                type="button" 
                onClick={() => handleAddItem('product', formState, setFormState)}
                className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1"
              >
                <Plus size={14} /> Add Peça
              </button>
            )}
          </div>
          
          <div className="space-y-3">
            {products.map((item, index) => (
              <div key={item.id} className="flex gap-3 items-start bg-background p-3 rounded-xl border border-border shadow-sm">
                <div className="flex-1">
                  <input 
                    type="text" 
                    value={item.name}
                    onChange={(e) => handleUpdateItem(item.id, 'name', e.target.value, formState, setFormState)}
                    placeholder="Descrição da peça (ex: Placa Mãe, Óleo)"
                    className="w-full bg-transparent text-sm focus:outline-none text-foreground font-medium mb-2"
                    disabled={!isEditMode && !!selectedQuote}
                  />
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Qtd:</span>
                      <input 
                        type="number" 
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleUpdateItem(item.id, 'quantity', Number(e.target.value), formState, setFormState)}
                        className="w-16 bg-secondary/50 border border-border rounded-lg px-2 py-1 text-xs focus:outline-none text-foreground"
                        disabled={!isEditMode && !!selectedQuote}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">R$ Unit:</span>
                      <input 
                        type="number" 
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => handleUpdateItem(item.id, 'unitPrice', Number(e.target.value), formState, setFormState)}
                        className="w-24 bg-secondary/50 border border-border rounded-lg px-2 py-1 text-xs focus:outline-none text-foreground"
                        disabled={!isEditMode && !!selectedQuote}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between self-stretch">
                  <span className="text-sm font-bold text-foreground">
                    {formatCurrency(item.quantity * item.unitPrice)}
                  </span>
                  {(!selectedQuote || isEditMode) && (
                    <button 
                      type="button" 
                      onClick={() => handleDeleteItem(item.id, formState, setFormState)}
                      className="text-red-500 hover:bg-red-500/10 p-1.5 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {products.length === 0 && (
              <p className="text-xs text-muted text-center py-4 italic">Nenhuma peça adicionada.</p>
            )}
          </div>
        </div>

        {/* Labor Section */}
        <div className="bg-secondary/10 border border-border rounded-2xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Calculator size={16} className="text-accent" /> Mão de Obra
            </h3>
            {(!selectedQuote || isEditMode) && (
              <button 
                type="button" 
                onClick={() => handleAddItem('labor', formState, setFormState)}
                className="text-xs font-bold text-accent hover:text-accent/80 flex items-center gap-1"
              >
                <Plus size={14} /> Add Serviço
              </button>
            )}
          </div>
          
          <div className="space-y-3">
            {labor.map((item, index) => (
              <div key={item.id} className="flex gap-3 items-start bg-background p-3 rounded-xl border border-border shadow-sm">
                <div className="flex-1">
                  <input 
                    type="text" 
                    value={item.name}
                    onChange={(e) => handleUpdateItem(item.id, 'name', e.target.value, formState, setFormState)}
                    placeholder="Descrição do serviço (ex: Formatação, Pintura)"
                    className="w-full bg-transparent text-sm focus:outline-none text-foreground font-medium mb-2"
                    disabled={!isEditMode && !!selectedQuote}
                  />
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">Horas/Qtd:</span>
                      <input 
                        type="number" 
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleUpdateItem(item.id, 'quantity', Number(e.target.value), formState, setFormState)}
                        className="w-16 bg-secondary/50 border border-border rounded-lg px-2 py-1 text-xs focus:outline-none text-foreground"
                        disabled={!isEditMode && !!selectedQuote}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">R$ Valor:</span>
                      <input 
                        type="number" 
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => handleUpdateItem(item.id, 'unitPrice', Number(e.target.value), formState, setFormState)}
                        className="w-24 bg-secondary/50 border border-border rounded-lg px-2 py-1 text-xs focus:outline-none text-foreground"
                        disabled={!isEditMode && !!selectedQuote}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between self-stretch">
                  <span className="text-sm font-bold text-foreground">
                    {formatCurrency(item.quantity * item.unitPrice)}
                  </span>
                  {(!selectedQuote || isEditMode) && (
                    <button 
                      type="button" 
                      onClick={() => handleDeleteItem(item.id, formState, setFormState)}
                      className="text-red-500 hover:bg-red-500/10 p-1.5 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {labor.length === 0 && (
              <p className="text-xs text-muted text-center py-4 italic">Nenhum serviço adicionado.</p>
            )}
          </div>
        </div>

        {/* Payment & Totals */}
        <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Forma de Pagamento</label>
                <input 
                  type="text" 
                  value={formState.paymentMethod || ''}
                  onChange={(e) => setFormState({...formState, paymentMethod: e.target.value})}
                  className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary text-foreground"
                  placeholder="Ex: Pix, Cartão 3x"
                  disabled={!isEditMode && !!selectedQuote}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Observações</label>
                <textarea 
                  value={formState.notes || ''}
                  onChange={(e) => setFormState({...formState, notes: e.target.value})}
                  className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary text-foreground min-h-[80px]"
                  placeholder="Garantia, prazo de entrega..."
                  disabled={!isEditMode && !!selectedQuote}
                />
              </div>
            </div>

            <div className="bg-secondary/10 p-4 rounded-xl flex flex-col justify-between border border-border/50">
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted font-medium">Subtotal</span>
                  <span className="font-bold text-foreground">{formatCurrency(calculateSubtotal(formState.items))}</span>
                </div>
                
                <div className="flex justify-between items-center text-sm border-b border-border/40 pb-3">
                  <span className="text-muted font-medium">Desconto</span>
                  <div className="flex items-center gap-2">
                    <select
                      value={formState.discountType || 'fixed'}
                      onChange={(e) => setFormState({...formState, discountType: e.target.value as any})}
                      className="bg-background border border-border rounded-lg px-2 py-1 text-xs focus:outline-none text-foreground"
                      disabled={!isEditMode && !!selectedQuote}
                    >
                      <option value="fixed">R$</option>
                      <option value="percentage">%</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      value={formState.discount || 0}
                      onChange={(e) => setFormState({...formState, discount: Number(e.target.value)})}
                      className="w-20 bg-background border border-border rounded-lg px-2 py-1 text-xs focus:outline-none text-foreground text-right"
                      disabled={!isEditMode && !!selectedQuote}
                    />
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm font-bold text-foreground">Total Final</span>
                  <span className="text-2xl font-heading font-bold text-primary">{formatCurrency(calculateTotal(formState))}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    );
  };

  return (
    <div className="p-8 h-full flex flex-col print:p-0">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 shrink-0 print:hidden">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground flex items-center gap-2">
            <HandCoins size={28} className="text-primary" />
            Orçamentos e Propostas
          </h1>
          <p className="text-muted mt-1">Crie e gerencie orçamentos com peças e mão de obra separados.</p>
        </div>

        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsNewModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 text-sm"
          >
            <Plus size={18} />
            Novo Orçamento
          </motion.button>
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-panel border border-border rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden print:hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-secondary/30 shrink-0">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input
              type="text"
              placeholder="Buscar por cliente ou ID..."
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

        {/* Table */}
        <div className="flex-1 overflow-hidden relative">
          <div className="absolute inset-0 overflow-auto custom-scrollbar">
            <div className="overflow-x-auto min-h-full">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10 sticky top-0 z-10 backdrop-blur-md">
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">ID / Cliente</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Data</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Valor Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredQuotes.map((quote, index) => {
                      const StatusIcon = getStatusBadge(quote.status).icon;
                      return (
                        <motion.tr
                          key={quote.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2, delay: index * 0.03 }}
                          onClick={() => { setSelectedQuote(quote); setEditForm(quote); setIsEditing(false); }}
                          className="hover:bg-secondary/40 transition-colors group cursor-pointer"
                        >
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-secondary border border-border/50 text-muted flex items-center justify-center font-bold text-xs shadow-sm shrink-0">
                                #{quote.id}
                              </div>
                              <div>
                                <span className="text-base font-heading font-bold text-foreground group-hover:text-primary transition-colors block">
                                  {quote.clientName}
                                </span>
                                <span className="text-xs text-muted font-medium">{quote.items.length} itens inclusos</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <span className="block text-sm font-medium text-foreground">{new Date(quote.date).toLocaleDateString('pt-BR')}</span>
                          </td>
                          <td className="px-6 py-5">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold tracking-wider border shadow-sm ${getStatusBadge(quote.status).bg} ${getStatusBadge(quote.status).color} ${getStatusBadge(quote.status).border}`}>
                              <StatusIcon size={14} />
                              {getStatusBadge(quote.status).label}
                            </span>
                          </td>
                          <td className="px-6 py-5 text-right">
                            <span className="text-lg font-heading font-bold text-foreground">
                              {formatCurrency(calculateTotal(quote))}
                            </span>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>

                  {filteredQuotes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted">
                        Nenhum orçamento encontrado com esses filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* View/Edit Quote Drawer */}
      {selectedQuote && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedQuote(null)}
              className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm print:hidden"
            />
            <div className="fixed inset-0 z-[101] flex justify-end pointer-events-none print:absolute print:inset-0 print:pointer-events-auto">
              <motion.div
                initial={{ x: "100%", opacity: 0.5 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0.5 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="w-full max-w-2xl bg-background border-l border-border shadow-2xl h-full flex flex-col pointer-events-auto print:max-w-none print:w-full print:border-none print:shadow-none print:h-auto print:block"
              >
                {/* Drawer Header */}
                <div className="p-6 md:p-8 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0 print:hidden">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="text-2xl font-heading font-bold text-foreground">Orçamento #{selectedQuote.id}</h2>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold tracking-wider border shadow-sm ${getStatusBadge(selectedQuote.status).bg} ${getStatusBadge(selectedQuote.status).color} ${getStatusBadge(selectedQuote.status).border}`}>
                        {getStatusBadge(selectedQuote.status).label}
                      </span>
                    </div>
                    <p className="text-muted text-sm">Gerencie os detalhes desta proposta comercial.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handlePrint}
                      className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                      title="Imprimir PDF"
                    >
                      <Printer size={20} />
                    </button>
                    {!isEditing && (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="p-2 text-primary hover:text-primary bg-primary/10 hover:bg-primary/20 rounded-full transition-colors flex items-center justify-center"
                        title="Editar Orçamento"
                      >
                        <Edit2 size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedQuote(null)}
                      className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                {/* Print Only Header (shown only when printing) */}
                <div className="hidden print:block mb-8 border-b-2 border-foreground pb-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h1 className="text-3xl font-bold font-heading">Proposta Comercial</h1>
                      <p className="text-xl font-medium mt-1">{selectedQuote.clientName}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">Orçamento #{selectedQuote.id}</p>
                      <p className="text-sm mt-1">Data: {new Date(selectedQuote.date).toLocaleDateString('pt-BR')}</p>
                    </div>
                  </div>
                </div>

                {/* Drawer Body */}
                <form onSubmit={handleUpdateQuote} className="p-6 md:p-8 flex-1 overflow-y-auto custom-scrollbar print:overflow-visible print:block print:p-0">
                  {renderDrawerForm(isEditing ? editForm : selectedQuote, isEditing ? setEditForm : () => {}, isEditing)}
                </form>

                <AnimatePresence>
                  {(isEditing) && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="p-6 border-t border-border bg-background flex gap-3 sticky bottom-0 print:hidden"
                    >
                      <button
                        type="button"
                        onClick={() => { handleDeleteQuote(selectedQuote.id) }}
                        className="p-3.5 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={20} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setEditForm(selectedQuote); setIsEditing(false); }}
                        className="flex-1 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleUpdateQuote}
                        className="flex-1 py-3.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                      >
                        Salvar Alterações
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

      {/* Create Quote Modal (Drawer style) */}
      {isNewModalOpen && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNewModalOpen(false)}
              className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex justify-end pointer-events-none">
              <motion.div
                initial={{ x: "100%", opacity: 0.5 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0.5 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="w-full max-w-2xl bg-background border-l border-border shadow-2xl h-full flex flex-col pointer-events-auto"
              >
                {/* Drawer Header */}
                <div className="p-6 md:p-8 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
                  <div>
                    <h2 className="text-2xl font-heading font-bold text-foreground">Novo Orçamento</h2>
                    <p className="text-muted text-sm mt-1">Crie uma nova proposta comercial.</p>
                  </div>
                  <button
                    onClick={() => setIsNewModalOpen(false)}
                    className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Drawer Body */}
                <form id="newQuoteForm" onSubmit={handleCreateQuote} className="p-6 md:p-8 flex-1 overflow-y-auto custom-scrollbar">
                  {renderDrawerForm(newQuote, setNewQuote, true)}
                </form>

                {/* Drawer Footer */}
                <div className="p-6 border-t border-border bg-background flex gap-3 sticky bottom-0">
                  <button
                    type="button"
                    onClick={() => setIsNewModalOpen(false)}
                    className="flex-1 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    form="newQuoteForm"
                    className="flex-1 py-3.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={18} />
                    Criar Orçamento
                  </button>
                </div>

              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

    </div>
  );
};

export default QuotesList;
