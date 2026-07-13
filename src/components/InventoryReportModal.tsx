import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Printer, Package, AlertTriangle, Box, ArrowUp, CheckCircle2 } from 'lucide-react';
import type { Product } from '../pages/app/InventoryList';

interface InventoryReportModalProps {
  products: Product[];
  onClose: () => void;
}

const InventoryReportModal: React.FC<InventoryReportModalProps> = ({ products, onClose }) => {

  // Metrics Calculation
  const totalItems = products.reduce((acc, p) => acc + p.quantity, 0);
  const totalValue = products.reduce((acc, p) => acc + (p.quantity * p.price), 0);
  
  const lowStockProducts = products.filter(p => p.quantity > 0 && p.quantity <= p.minQuantity);
  const outOfStockProducts = products.filter(p => p.quantity === 0);
  
  const lowStockItems = lowStockProducts.length;
  const outOfStockItems = outOfStockProducts.length;

  // Most valuable stock items (quantity * price)
  const topValuable = [...products]
    .map(p => ({ ...p, totalValue: p.quantity * p.price }))
    .filter(p => p.totalValue > 0)
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 5);

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
                <Package className="text-primary" size={24} /> 
                Relatório de Estoque
              </h2>
              <p className="text-muted text-sm mt-1">Visão analítica de quantidades, valores e alertas de reposição.</p>
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
                  <h3 className="text-sm font-medium text-muted">Total de Itens</h3>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Box size={16} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground">{totalItems} unid.</p>
                <p className="text-xs text-muted mt-1">Quantidade física geral</p>
              </div>

              <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-sm font-medium text-muted">Estoque Baixo</h3>
                  <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
                    <AlertTriangle size={16} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground">{lowStockItems}</p>
                <p className="text-xs text-muted mt-1">Abaixo da Qtd. Mínima</p>
              </div>

              <div className="bg-background border border-red-500/30 rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-sm font-medium text-muted">Esgotados</h3>
                  <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                    <X size={16} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-red-500">{outOfStockItems}</p>
                <p className="text-xs text-muted mt-1">Zerados no sistema</p>
              </div>

              <div className="bg-green-500/5 border border-green-500/30 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-green-500/10 rounded-bl-full -mr-4 -mt-4 blur-xl"></div>
                <div className="flex justify-between items-start mb-2 relative z-10">
                  <h3 className="text-sm font-medium text-green-600">Valor em Estoque</h3>
                  <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-600">
                    <ArrowUp size={16} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground relative z-10">{formatCurrency(totalValue)}</p>
                <p className="text-xs text-green-600/80 mt-1 relative z-10">Patrimônio / Custo total</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 print:block print:space-y-8">
              {/* Needs Replenishment */}
              <div className="print:break-inside-auto">
                <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2 mb-4 print:break-after-avoid">
                  <AlertTriangle size={18} className="text-orange-500" /> Precisam de Reposição
                </h3>
                
                {outOfStockProducts.length > 0 || lowStockProducts.length > 0 ? (
                  <div className="bg-background border border-border rounded-2xl overflow-hidden shadow-sm print:overflow-visible">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b-2 border-border/60 bg-secondary/10">
                          <th className="px-6 py-4 text-xs font-heading font-semibold text-foreground/90 uppercase tracking-wider">Produto / Local</th>
                          <th className="px-6 py-4 text-xs font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Qtd</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {outOfStockProducts.map((p, index) => (
                          <tr key={`out-${index}`} className="bg-red-500/5 hover:bg-red-500/10 transition-colors print:break-inside-avoid">
                            <td className="px-6 py-4">
                              <div className="font-bold text-foreground flex items-center gap-2">
                                <X size={14} className="text-red-500" /> {p.name}
                              </div>
                              <div className="text-xs text-muted">{p.location || 'Sem local'}</div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="font-bold text-red-500">0</span>
                            </td>
                          </tr>
                        ))}
                        {lowStockProducts.map((p, index) => (
                          <tr key={`low-${index}`} className="hover:bg-secondary/10 transition-colors print:break-inside-avoid">
                            <td className="px-6 py-4">
                              <div className="font-bold text-foreground flex items-center gap-2">
                                <AlertTriangle size={14} className="text-orange-500" /> {p.name}
                              </div>
                              <div className="text-xs text-muted">Min: {p.minQuantity} | {p.location || 'Sem local'}</div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="font-bold text-orange-500">{p.quantity}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-10 bg-green-500/5 border border-green-500/20 border-dashed rounded-2xl">
                    <CheckCircle2 size={32} className="mx-auto text-green-500 mb-3" />
                    <p className="text-sm font-bold text-green-600">Estoque Saudável!</p>
                    <p className="text-xs text-green-600/70 mt-1">Nenhum produto precisando de reposição no momento.</p>
                  </div>
                )}
              </div>

              {/* Top Valuable */}
              <div className="print:break-inside-auto print:mt-8">
                <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2 mb-4 print:break-after-avoid">
                  <ArrowUp size={18} className="text-green-500" /> Maior Valor em Estoque
                </h3>
                
                {topValuable.length > 0 ? (
                  <div className="bg-background border border-border rounded-2xl overflow-hidden shadow-sm print:overflow-visible">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b-2 border-border/60 bg-secondary/10">
                          <th className="px-6 py-4 text-xs font-heading font-semibold text-foreground/90 uppercase tracking-wider">Produto</th>
                          <th className="px-6 py-4 text-xs font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Valor Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {topValuable.map((p, index) => (
                          <tr key={index} className="hover:bg-secondary/10 transition-colors print:break-inside-avoid">
                            <td className="px-6 py-4">
                              <div className="font-bold text-foreground">{p.name}</div>
                              <div className="text-xs text-muted">{p.quantity} unid. x {formatCurrency(p.price)}</div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="font-bold text-foreground">{formatCurrency(p.totalValue)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-10 bg-secondary/10 border border-border border-dashed rounded-2xl">
                    <p className="text-sm font-bold text-muted">Sem dados suficientes.</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default InventoryReportModal;
