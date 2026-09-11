import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Search, Plus, Filter, ShoppingCart, CheckCircle2, X, Trash2, TrendingDown, Clock, Building2, Package, Tag, ArrowRight, AlertCircle, FileText } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import PurchasingReportModal from '../../components/PurchasingReportModal';

export interface SupplierQuote {
  id: string;
  supplierName: string;
  price: number;
  deliveryDays: number;
  lastUpdated: string;
}

export interface PurchasableProduct {
  id: string;
  name: string;
  sku: string;
  ean: string;
  category: string;
  suppliers: SupplierQuote[];
}

const mockProducts: PurchasableProduct[] = [
  {
    id: '1',
    name: 'Óleo Sintético 5W40',
    sku: 'OL-5W40-01',
    ean: '7891234567890',
    category: 'Lubrificantes',
    suppliers: [
      { id: 's1', supplierName: 'Distribuidora AutoPeças', price: 35.90, deliveryDays: 2, lastUpdated: '2026-07-01' },
      { id: 's2', supplierName: 'Lubrificantes Express', price: 32.50, deliveryDays: 5, lastUpdated: '2026-07-05' },
      { id: 's3', supplierName: 'Global Parts', price: 38.00, deliveryDays: 1, lastUpdated: '2026-07-08' }
    ]
  },
  {
    id: '2',
    name: 'Filtro de Ar Condicionado',
    sku: 'FLT-AR-99',
    ean: '7890987654321',
    category: 'Filtros',
    suppliers: [
      { id: 's4', supplierName: 'Global Parts', price: 18.50, deliveryDays: 3, lastUpdated: '2026-06-20' },
      { id: 's5', supplierName: 'Distribuidora AutoPeças', price: 18.50, deliveryDays: 1, lastUpdated: '2026-07-09' }
    ]
  },
  {
    id: '3',
    name: 'Pastilha de Freio Cerâmica',
    sku: 'FREIO-CER-01',
    ean: '7891122334455',
    category: 'Freios',
    suppliers: []
  }
];

const PurchasingList = () => {
  const [products, setProducts] = useState<PurchasableProduct[]>(mockProducts);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Drawer states
  const [selectedProduct, setSelectedProduct] = useState<PurchasableProduct | null>(null);
  
  // New Supplier Form inside Drawer
  const [newSupplier, setNewSupplier] = useState<Partial<SupplierQuote>>({
    supplierName: '', price: 0, deliveryDays: 1, lastUpdated: new Date().toISOString().split('T')[0]
  });

  // New Product Form state
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [newPurchasableProduct, setNewPurchasableProduct] = useState<Partial<PurchasableProduct>>({
    name: '', sku: '', ean: '', category: ''
  });

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  useEscapeKey(() => {
    setSelectedProduct(null);
    setIsNewProductModalOpen(false);
    setIsReportModalOpen(false);
  });

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  const getBestSupplier = (suppliers: SupplierQuote[]) => {
    if (!suppliers || suppliers.length === 0) return null;
    return suppliers.reduce((prev, curr) => (prev.price < curr.price ? prev : curr));
  };

  const filteredProducts = products.filter(p => {
    if (!searchQuery) return true;
    const lower = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(lower) || 
           p.sku.toLowerCase().includes(lower) ||
           p.ean.toLowerCase().includes(lower);
  });

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPurchasableProduct.name) return;

    const newProd: PurchasableProduct = {
      id: crypto.randomUUID(),
      name: newPurchasableProduct.name,
      sku: newPurchasableProduct.sku || '',
      ean: newPurchasableProduct.ean || '',
      category: newPurchasableProduct.category || 'Geral',
      suppliers: []
    };

    setProducts([newProd, ...products]);
    setIsNewProductModalOpen(false);
    setNewPurchasableProduct({ name: '', sku: '', ean: '', category: '' });
  };

  const handleAddSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct || !newSupplier.supplierName || !newSupplier.price) return;

    const newQuote: SupplierQuote = {
      id: crypto.randomUUID(),
      supplierName: newSupplier.supplierName,
      price: newSupplier.price,
      deliveryDays: newSupplier.deliveryDays || 1,
      lastUpdated: newSupplier.lastUpdated || new Date().toISOString().split('T')[0]
    };

    const updatedProduct = {
      ...selectedProduct,
      suppliers: [...selectedProduct.suppliers, newQuote]
    };

    setProducts(products.map(p => p.id === updatedProduct.id ? updatedProduct : p));
    setSelectedProduct(updatedProduct);
    setNewSupplier({ supplierName: '', price: 0, deliveryDays: 1, lastUpdated: new Date().toISOString().split('T')[0] });
  };

  const handleDeleteSupplier = (supplierId: string) => {
    if (!selectedProduct) return;
    const updatedProduct = {
      ...selectedProduct,
      suppliers: selectedProduct.suppliers.filter(s => s.id !== supplierId)
    };
    setProducts(products.map(p => p.id === updatedProduct.id ? updatedProduct : p));
    setSelectedProduct(updatedProduct);
  };

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground flex items-center gap-2">
            <ShoppingCart size={28} className="text-primary" />
            Compras e Cotações
          </h1>
          <p className="text-muted mt-1">Compare preços de fornecedores e tome a melhor decisão de compra.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsReportModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-secondary/50 text-foreground hover:bg-secondary rounded-xl font-medium transition-colors border border-border"
          >
            <FileText size={18} />
            Relatórios
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setIsNewProductModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 text-sm"
          >
            <Plus size={18} />
            Novo Produto base
          </motion.button>
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-panel border border-border rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center bg-secondary/30 shrink-0">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
            <input
              type="text"
              placeholder="Buscar por produto, SKU ou EAN..."
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
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Produto</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-center">Fornecedores</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Melhor Preço (Atual)</th>
                    <th className="px-6 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredProducts.map((product, index) => {
                      const bestQuote = getBestSupplier(product.suppliers);
                      return (
                        <motion.tr
                          key={product.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2, delay: index * 0.03 }}
                          onClick={() => setSelectedProduct(product)}
                          className="hover:bg-secondary/40 transition-colors group cursor-pointer"
                        >
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-secondary border border-border/50 text-muted flex items-center justify-center font-bold text-xs shadow-sm shrink-0">
                                <Package size={18} />
                              </div>
                              <div>
                                <span className="text-base font-heading font-bold text-foreground group-hover:text-primary transition-colors block">
                                  {product.name}
                                </span>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] uppercase tracking-wider font-bold text-muted bg-secondary px-2 py-0.5 rounded border border-border/50">SKU: {product.sku}</span>
                                  {product.ean && (
                                    <span className="text-[10px] uppercase tracking-wider font-bold text-muted bg-secondary px-2 py-0.5 rounded border border-border/50">EAN: {product.ean}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-center">
                            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary/50 border border-border font-bold text-sm text-foreground">
                              {product.suppliers.length}
                            </span>
                          </td>
                          <td className="px-6 py-5">
                            {bestQuote ? (
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-lg font-heading font-bold text-green-500 flex items-center gap-1">
                                    <TrendingDown size={18} />
                                    {formatCurrency(bestQuote.price)}
                                  </span>
                                </div>
                                <span className="text-xs font-medium text-muted flex items-center gap-1">
                                  <Building2 size={12} /> {bestQuote.supplierName}
                                </span>
                              </div>
                            ) : (
                              <span className="text-sm font-medium text-muted italic flex items-center gap-2">
                                <AlertCircle size={14} className="text-orange-500" />
                                Sem cotações
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-5 text-right">
                            <button className="text-primary hover:text-primary/80 text-sm font-bold flex items-center gap-1 ml-auto group-hover:translate-x-1 transition-transform">
                              Cotações <ArrowRight size={16} />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>

                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-muted">
                        Nenhum produto encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Supplier Quotes Drawer */}
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
                className="w-full max-w-2xl bg-background border-l border-border shadow-2xl h-full flex flex-col pointer-events-auto"
              >
                {/* Drawer Header */}
                <div className="p-6 md:p-8 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
                  <div>
                    <h2 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
                      <Tag size={20} className="text-primary" />
                      Cotações: {selectedProduct.name}
                    </h2>
                    <p className="text-muted text-sm mt-1">SKU: {selectedProduct.sku}</p>
                  </div>
                  <button
                    onClick={() => setSelectedProduct(null)}
                    className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Drawer Body */}
                <div className="p-6 md:p-8 flex-1 overflow-y-auto custom-scrollbar space-y-8">
                  
                  {/* New Quote Form */}
                  <div className="bg-secondary/10 border border-border rounded-2xl p-5">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-4">
                      <Plus size={16} className="text-primary" /> Adicionar Cotação
                    </h3>
                    <form onSubmit={handleAddSupplier} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Fornecedor</label>
                        <input 
                          type="text"
                          required
                          value={newSupplier.supplierName}
                          onChange={(e) => setNewSupplier({...newSupplier, supplierName: e.target.value})}
                          placeholder="Nome da empresa..."
                          className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary text-foreground"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Preço Unitário (R$)</label>
                        <input 
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={newSupplier.price || ''}
                          onChange={(e) => setNewSupplier({...newSupplier, price: Number(e.target.value)})}
                          placeholder="0,00"
                          className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary text-foreground"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Prazo (Dias úteis)</label>
                        <input 
                          type="number"
                          min="0"
                          value={newSupplier.deliveryDays}
                          onChange={(e) => setNewSupplier({...newSupplier, deliveryDays: Number(e.target.value)})}
                          className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-primary text-foreground"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <button 
                          type="submit"
                          className="w-full py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                        >
                          Salvar Cotação
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Quotes List */}
                  <div>
                    <h3 className="text-sm font-bold text-foreground mb-4">Cotações Cadastradas ({selectedProduct.suppliers.length})</h3>
                    <div className="space-y-3">
                      {selectedProduct.suppliers.sort((a, b) => a.price - b.price).map((quote, index) => {
                        const isBest = index === 0 && selectedProduct.suppliers.length > 1; // Cheapest
                        return (
                          <div 
                            key={quote.id} 
                            className={`p-4 rounded-xl border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between transition-colors ${
                              isBest 
                                ? 'bg-green-500/5 border-green-500/30' 
                                : 'bg-background border-border shadow-sm hover:border-primary/30'
                            }`}
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-foreground">{quote.supplierName}</span>
                                {isBest && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-green-500/20 text-green-600 border border-green-500/20">
                                    <CheckCircle2 size={12} />
                                    Mais Barato
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-xs font-medium text-muted">
                                <span className="flex items-center gap-1">
                                  <Clock size={12} /> Prazo: {quote.deliveryDays} {quote.deliveryDays === 1 ? 'dia' : 'dias'}
                                </span>
                                <span>Atualizado: {new Date(quote.lastUpdated).toLocaleDateString('pt-BR')}</span>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                              <span className={`text-xl font-heading font-bold ${isBest ? 'text-green-500' : 'text-foreground'}`}>
                                {formatCurrency(quote.price)}
                              </span>
                              <button
                                onClick={() => handleDeleteSupplier(quote.id)}
                                className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                                title="Excluir Cotação"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {selectedProduct.suppliers.length === 0 && (
                        <div className="text-center py-8 bg-secondary/10 rounded-xl border border-border border-dashed">
                          <p className="text-muted text-sm">Nenhuma cotação cadastrada para este produto.</p>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

      {/* New Product Modal (Drawer style) */}
      {isNewProductModalOpen && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNewProductModalOpen(false)}
              className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex justify-end pointer-events-none">
              <motion.div
                initial={{ x: "100%", opacity: 0.5 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0.5 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="w-full max-w-xl bg-background border-l border-border shadow-2xl h-full flex flex-col pointer-events-auto"
              >
                <div className="p-6 md:p-8 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
                  <div>
                    <h2 className="text-xl font-heading font-bold text-foreground">Novo Produto Base</h2>
                    <p className="text-muted text-sm mt-1">Cadastre um produto para começar a cotar.</p>
                  </div>
                  <button
                    onClick={() => setIsNewProductModalOpen(false)}
                    className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form id="newProductForm" onSubmit={handleCreateProduct} className="p-6 md:p-8 flex-1 overflow-y-auto custom-scrollbar space-y-6">
                  <div>
                    <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Nome do Produto *</label>
                    <input 
                      type="text"
                      required
                      value={newPurchasableProduct.name}
                      onChange={(e) => setNewPurchasableProduct({...newPurchasableProduct, name: e.target.value})}
                      placeholder="Ex: Óleo de Motor 5W30"
                      className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary text-foreground transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">SKU</label>
                      <input 
                        type="text"
                        value={newPurchasableProduct.sku}
                        onChange={(e) => setNewPurchasableProduct({...newPurchasableProduct, sku: e.target.value})}
                        placeholder="Código interno..."
                        className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary text-foreground transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">EAN / Código de Barras</label>
                      <input 
                        type="text"
                        value={newPurchasableProduct.ean}
                        onChange={(e) => setNewPurchasableProduct({...newPurchasableProduct, ean: e.target.value})}
                        placeholder="EAN do produto..."
                        className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary text-foreground transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Categoria</label>
                    <input 
                      type="text"
                      value={newPurchasableProduct.category}
                      onChange={(e) => setNewPurchasableProduct({...newPurchasableProduct, category: e.target.value})}
                      placeholder="Ex: Lubrificantes"
                      className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary text-foreground transition-colors"
                    />
                  </div>
                </form>

                <div className="p-6 border-t border-border bg-background flex gap-3 sticky bottom-0">
                  <button
                    type="button"
                    onClick={() => setIsNewProductModalOpen(false)}
                    className="flex-1 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    form="newProductForm"
                    className="flex-1 py-3.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={18} />
                    Criar Produto
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

      <PurchasingReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        products={products}
      />
    </div>
  );
};

export default PurchasingList;
