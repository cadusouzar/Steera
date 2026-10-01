import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Search, Plus, Archive, Package, AlertTriangle, X, Edit2, Trash2, Box, Info, Filter, ArrowUp, FileText } from 'lucide-react';
import InventoryReportModal from '../../components/InventoryReportModal';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export interface Product {
  id: string;
  name: string;
  sku: string;
  ean: string;
  category: string;
  quantity: number;
  minQuantity: number;
  price: number;
  location: string;
}

const mockProducts: Product[] = [
  { id: '1', name: 'Notebook Dell XPS 13', sku: 'ND-XPS13-001', ean: '7891000100010', category: 'Eletrônicos', quantity: 12, minQuantity: 5, price: 7500.00, location: 'Prateleira A1' },
  { id: '2', name: 'Mouse Sem Fio Logitech', sku: 'ML-W001', ean: '7891000100027', category: 'Acessórios', quantity: 15, minQuantity: 20, price: 150.00, location: 'Prateleira B3' },
  { id: '3', name: 'Monitor LG UltraWide', sku: 'MO-LG-UW001', ean: '7891000100034', category: 'Eletrônicos', quantity: 0, minQuantity: 2, price: 1200.00, location: 'Corredor 2' },
  { id: '4', name: 'Teclado Mecânico Keychron', sku: 'TK-K2-001', ean: '7891000100041', category: 'Acessórios', quantity: 8, minQuantity: 5, price: 650.00, location: 'Depósito 1' },
];

const InventoryList = () => {
  const [products, setProducts] = useState<Product[]>(mockProducts);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Product>>({});

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [newProduct, setNewProduct] = useState<Partial<Product>>({
    name: '', sku: '', ean: '', category: '', quantity: 0, minQuantity: 0, price: 0, location: ''
  });

  useEscapeKey(() => {
    setSelectedProduct(null);
    setIsNewProductModalOpen(false);
    setIsReportModalOpen(false);
  });

  const filteredProducts = products.filter(p => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return p.name.toLowerCase().includes(lowerQuery) ||
      p.sku.toLowerCase().includes(lowerQuery) ||
      p.ean.toLowerCase().includes(lowerQuery) ||
      p.category.toLowerCase().includes(lowerQuery);
  });

  const getStatus = (quantity: number, minQuantity: number) => {
    if (quantity === 0) return { label: 'Esgotado', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' };
    if (quantity <= minQuantity) return { label: 'Estoque Baixo', color: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' };
    return { label: 'Em Estoque', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' };
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProduct.name || !newProduct.sku) return;

    const created: Product = {
      id: Math.random().toString(36).substring(7),
      name: newProduct.name || '',
      sku: newProduct.sku || '',
      ean: newProduct.ean || '',
      category: newProduct.category || '',
      quantity: Number(newProduct.quantity) || 0,
      minQuantity: Number(newProduct.minQuantity) || 0,
      price: Number(newProduct.price) || 0,
      location: newProduct.location || '',
    };

    setProducts([created, ...products]);
    setNewProduct({ name: '', sku: '', ean: '', category: '', quantity: 0, minQuantity: 0, price: 0, location: '' });
    setIsNewProductModalOpen(false);
  };

  const handleUpdateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.name || !editForm.sku) return;

    setProducts(products.map(p => p.id === editForm.id ? editForm as Product : p));
    setSelectedProduct(null);
    setIsEditing(false);
  };

  const handleDeleteProduct = (id: string) => {
    setProducts(products.filter(p => p.id !== id));
    setSelectedProduct(null);
    setIsEditing(false);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  // Summary logic
  const totalItems = products.reduce((acc, p) => acc + p.quantity, 0);
  const lowStockItems = products.filter(p => p.quantity > 0 && p.quantity <= p.minQuantity).length;
  const outOfStockItems = products.filter(p => p.quantity === 0).length;
  const totalValue = products.reduce((acc, p) => acc + (p.quantity * p.price), 0);

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 shrink-0">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground flex items-center gap-2">
            <Package size={28} className="text-primary" />
            Controle de Estoque
          </h1>
          <p className="text-muted mt-1">Gerencie produtos, quantidades, SKUs e EANs da sua empresa.</p>
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
            onClick={() => setIsNewProductModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 text-sm"
          >
            <Plus size={18} />
            Novo Produto
          </motion.button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 shrink-0">
        <div className="bg-panel border border-border rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:border-primary/30 transition-colors">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Box size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-muted uppercase tracking-wider">Itens em Estoque</p>
            <p className="text-2xl font-bold text-foreground">{totalItems}</p>
          </div>
        </div>
        <div className="bg-panel border border-border rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:border-orange-500/30 transition-colors">
          <div className="w-12 h-12 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0">
            <AlertTriangle size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-muted uppercase tracking-wider">Estoque Baixo</p>
            <p className="text-2xl font-bold text-foreground">{lowStockItems}</p>
          </div>
        </div>
        <div className="bg-panel border border-border rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:border-red-500/30 transition-colors">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
            <X size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-muted uppercase tracking-wider">Esgotados</p>
            <p className="text-2xl font-bold text-foreground">{outOfStockItems}</p>
          </div>
        </div>
        <div className="bg-panel border border-border rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:border-green-500/30 transition-colors">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 text-green-500 flex items-center justify-center shrink-0">
            <ArrowUp size={24} />
          </div>
          <div>
            <p className="text-xs font-bold text-muted uppercase tracking-wider">Valor em Estoque</p>
            <p className="text-xl font-bold text-foreground">{formatCurrency(totalValue)}</p>
          </div>
        </div>
      </div>

      <div className="bg-panel border border-border rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-secondary/30 shrink-0">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input
              type="text"
              placeholder="Buscar por nome, SKU, EAN ou categoria..."
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
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10 sticky top-0 z-10 backdrop-blur-md">
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Produto</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Categoria / Local</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Preço Unit.</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Quantidade / Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredProducts.map((product, index) => {
                      const status = getStatus(product.quantity, product.minQuantity);
                      return (
                        <motion.tr
                          key={product.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2, delay: index * 0.03 }}
                          onClick={() => { setSelectedProduct(product); setEditForm(product); setIsEditing(false); }}
                          className="hover:bg-secondary/40 transition-colors group cursor-pointer"
                        >
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-secondary border border-border/50 text-muted flex items-center justify-center font-bold text-sm shadow-sm shrink-0 group-hover:scale-105 group-hover:text-primary group-hover:border-primary/30 group-hover:bg-primary/5 transition-all">
                                <Archive size={18} />
                              </div>
                              <div>
                                <span className="text-base font-heading font-bold text-foreground group-hover:text-primary transition-colors block">
                                  {product.name}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-xs text-muted font-medium bg-secondary px-2 py-0.5 rounded border border-border/50">SKU: {product.sku}</span>
                                  {product.ean && <span className="text-xs text-muted font-medium bg-secondary px-2 py-0.5 rounded border border-border/50">EAN: {product.ean}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <span className="block text-sm font-medium text-foreground">{product.category || '-'}</span>
                            <span className="block text-xs text-muted mt-0.5">{product.location || 'Sem local'}</span>
                          </td>
                          <td className="px-6 py-5 text-sm font-bold text-foreground/80">
                            {formatCurrency(product.price)}
                          </td>
                          <td className="px-6 py-5 text-right">
                            <div className="flex flex-col items-end gap-1.5">
                              <span className="text-lg font-heading font-bold text-foreground">
                                {product.quantity} <span className="text-sm font-normal text-muted">unid.</span>
                              </span>
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold tracking-wider border shadow-sm ${status.bg} ${status.color} ${status.border}`}>
                                {status.label}
                              </span>
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>

                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-8 py-16 text-center text-muted">
                        <div className="flex flex-col items-center justify-center">
                          <Package size={48} className="opacity-20 mb-4" />
                          <p className="text-lg font-medium">Nenhum produto encontrado.</p>
                          <p className="text-sm mt-1">Tente ajustar seus filtros de busca ou cadastre um novo produto.</p>
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

      {/* New Product Modal */}
      <AnimatePresence>
        {isNewProductModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsNewProductModalOpen(false)}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex justify-center items-center p-4"
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-background border border-border/60 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
              <div className="p-6 border-b border-border flex items-center justify-between shrink-0 mt-2">
                <h2 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
                  <Package className="text-primary" size={24} />
                  Novo Produto
                </h2>
                <button onClick={() => setIsNewProductModalOpen(false)} className="p-2 text-muted hover:text-foreground rounded-full hover:bg-secondary transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateProduct} className="p-6 overflow-y-auto custom-scrollbar space-y-6">

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2 border-b border-border/50 pb-2">
                    <Info size={16} className="text-primary" /> Informações Básicas
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Nome do Produto <span className="text-red-500">*</span></label>
                      <input required value={newProduct.name} onChange={e => setNewProduct({ ...newProduct, name: e.target.value })} type="text" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="Ex: Monitor UltraWide LG" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground/90 mb-1.5">SKU (Código Interno) <span className="text-red-500">*</span></label>
                      <input required value={newProduct.sku} onChange={e => setNewProduct({ ...newProduct, sku: e.target.value })} type="text" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground uppercase" placeholder="Ex: MO-LG-UW001" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground/90 mb-1.5">EAN (Código de Barras)</label>
                      <input value={newProduct.ean} onChange={e => setNewProduct({ ...newProduct, ean: e.target.value })} type="text" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="Ex: 7891000100010" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Categoria</label>
                      <input value={newProduct.category} onChange={e => setNewProduct({ ...newProduct, category: e.target.value })} type="text" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="Ex: Eletrônicos" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Localização</label>
                      <input value={newProduct.location} onChange={e => setNewProduct({ ...newProduct, location: e.target.value })} type="text" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="Ex: Prateleira A1" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2 border-b border-border/50 pb-2">
                    <Box size={16} className="text-primary" /> Estoque e Valores
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Qtd. Inicial</label>
                      <input value={newProduct.quantity || ''} onChange={e => setNewProduct({ ...newProduct, quantity: Number(e.target.value) })} type="number" min="0" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="0" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Qtd. Mínima (Alerta)</label>
                      <input value={newProduct.minQuantity || ''} onChange={e => setNewProduct({ ...newProduct, minQuantity: Number(e.target.value) })} type="number" min="0" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="0" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Preço Unitário</label>
                      <input value={newProduct.price || ''} onChange={e => setNewProduct({ ...newProduct, price: Number(e.target.value) })} type="number" step="0.01" min="0" className="w-full bg-secondary/30 border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground" placeholder="0,00" />
                    </div>
                  </div>
                </div>

                <div className="pt-6 flex gap-3 sticky bottom-0 bg-background pb-2">
                  <button type="button" onClick={() => setIsNewProductModalOpen(false)} className="flex-1 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm">Cancelar</button>
                  <button type="submit" className="flex-1 py-3.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-bold transition-colors shadow-md shadow-primary/20 flex items-center justify-center gap-2"><Plus size={18} /> Cadastrar Produto</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Product Details / Edit Drawer */}
      {selectedProduct && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedProduct(null)}
              className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex justify-end pointer-events-none">
              <motion.div
                initial={{ x: "100%", opacity: 0.5 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0.5 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="bg-background border-l border-border/60 w-full max-w-xl h-full flex flex-col shadow-2xl relative pointer-events-auto"
              >
                {/* Drawer Header */}
                <div className="p-6 md:p-8 border-b border-border/40 shrink-0">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 pr-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shadow-sm shrink-0">
                          <Archive size={24} />
                        </div>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full bg-background border border-border/80 rounded-lg px-3 py-1.5 text-2xl font-heading font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                            placeholder="Nome do Produto"
                          />
                        ) : (
                          <h2 className="text-2xl font-heading font-bold text-foreground leading-tight">
                            {selectedProduct.name}
                          </h2>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isEditing && (
                        <button
                          onClick={() => setIsEditing(true)}
                          className="p-2 text-primary hover:text-primary bg-primary/10 hover:bg-primary/20 rounded-full transition-colors flex items-center justify-center"
                          title="Editar Produto"
                        >
                          <Edit2 size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedProduct(null)}
                        className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Drawer Body */}
                <form onSubmit={handleUpdateProduct} className="p-6 md:p-8 flex-1 overflow-y-auto custom-scrollbar">
                  <div className="space-y-8 pb-10">

                    {/* Status Section */}
                    {!isEditing && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-secondary/20 rounded-2xl border border-border/40 gap-4">
                        <div>
                          <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Status do Estoque</p>
                          <div className="flex items-center gap-3">
                            <span className="text-3xl font-heading font-bold text-foreground">{editForm.quantity}</span>
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider border shadow-sm ${getStatus(editForm.quantity!, selectedProduct.minQuantity).bg} ${getStatus(editForm.quantity!, selectedProduct.minQuantity).color} ${getStatus(editForm.quantity!, selectedProduct.minQuantity).border}`}>
                              {getStatus(editForm.quantity!, selectedProduct.minQuantity).label}
                            </span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button type="button" onClick={() => { setEditForm({ ...editForm, quantity: Math.max(0, editForm.quantity! - 1) }) }} className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center hover:bg-secondary transition-colors font-bold text-xl hover:text-red-500 shadow-sm">-</button>
                          <button type="button" onClick={() => { setEditForm({ ...editForm, quantity: editForm.quantity! + 1 }) }} className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center hover:bg-secondary transition-colors font-bold text-xl hover:text-green-500 shadow-sm">+</button>
                        </div>
                      </div>
                    )}

                    {!isEditing ? (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-background border border-border/60 p-4 rounded-2xl">
                            <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">SKU</p>
                            <p className="text-base font-medium text-foreground">{selectedProduct.sku}</p>
                          </div>
                          <div className="bg-background border border-border/60 p-4 rounded-2xl">
                            <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">EAN</p>
                            <p className="text-base font-medium text-foreground">{selectedProduct.ean || '-'}</p>
                          </div>
                          <div className="bg-background border border-border/60 p-4 rounded-2xl">
                            <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Categoria</p>
                            <p className="text-base font-medium text-foreground">{selectedProduct.category || '-'}</p>
                          </div>
                          <div className="bg-background border border-border/60 p-4 rounded-2xl">
                            <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Localização</p>
                            <p className="text-base font-medium text-foreground">{selectedProduct.location || '-'}</p>
                          </div>
                          <div className="bg-background border border-border/60 p-4 rounded-2xl">
                            <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Qtd. Mínima</p>
                            <p className="text-base font-medium text-foreground">{selectedProduct.minQuantity} unid.</p>
                          </div>
                          <div className="bg-background border border-border/60 p-4 rounded-2xl">
                            <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Preço Unitário</p>
                            <p className="text-base font-medium text-foreground">{formatCurrency(selectedProduct.price)}</p>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-border/40">
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct(selectedProduct.id)}
                            className="flex items-center gap-2 text-sm font-bold text-red-500 hover:text-white bg-red-500/10 hover:bg-red-500 px-4 py-2.5 rounded-xl transition-colors"
                          >
                            <Trash2 size={16} /> Excluir Produto
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-foreground/90 mb-1.5">SKU <span className="text-red-500">*</span></label>
                            <input required value={editForm.sku} onChange={e => setEditForm({ ...editForm, sku: e.target.value })} type="text" className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-foreground/90 mb-1.5">EAN</label>
                            <input value={editForm.ean} onChange={e => setEditForm({ ...editForm, ean: e.target.value })} type="text" className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Categoria</label>
                            <input value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} type="text" className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Localização</label>
                            <input value={editForm.location} onChange={e => setEditForm({ ...editForm, location: e.target.value })} type="text" className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-border/40 pt-6">
                          <div>
                            <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Quantidade Atual</label>
                            <input value={editForm.quantity} onChange={e => setEditForm({ ...editForm, quantity: Number(e.target.value) })} type="number" min="0" className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Qtd. Mínima</label>
                            <input value={editForm.minQuantity} onChange={e => setEditForm({ ...editForm, minQuantity: Number(e.target.value) })} type="number" min="0" className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Preço Unitário</label>
                            <input value={editForm.price} onChange={e => setEditForm({ ...editForm, price: Number(e.target.value) })} type="number" step="0.01" min="0" className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </form>

                <AnimatePresence>
                  {(isEditing || editForm.quantity !== selectedProduct.quantity) && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="p-6 border-t border-border bg-background flex gap-3 sticky bottom-0"
                    >
                      <button
                        type="button"
                        onClick={() => { setEditForm(selectedProduct); setIsEditing(false); }}
                        className="flex-1 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleUpdateProduct}
                        className="flex-1 py-3.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
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

      {isReportModalOpen && (
        <InventoryReportModal 
          products={products}
          onClose={() => setIsReportModalOpen(false)}
        />
      )}
    </div>
  );
};

export default InventoryList;
