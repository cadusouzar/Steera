import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, ShoppingCart, TrendingDown, Package, Building2, Download } from 'lucide-react';
import { PurchasableProduct } from '../pages/app/PurchasingList';

interface PurchasingReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: PurchasableProduct[];
}

const PurchasingReportModal: React.FC<PurchasingReportModalProps> = ({ isOpen, onClose, products }) => {
  if (!isOpen) return null;

  // Analytics
  const totalProducts = products.length;
  
  const totalSuppliers = new Set(
    products.flatMap(p => p.suppliers.map(s => s.supplierName))
  ).size;

  const productsWithQuotes = products.filter(p => p.suppliers.length > 0).length;
  const coveragePercentage = totalProducts > 0 ? (productsWithQuotes / totalProducts) * 100 : 0;

  // Most competitive product (most quotes)
  const mostQuotedProduct = [...products].sort((a, b) => b.suppliers.length - a.suppliers.length)[0];

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
        className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm print:absolute print:inset-0 print:block print:bg-white print:p-0"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-panel w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden print:w-full print:max-w-none print:h-auto print:max-h-none print:rounded-none print:border-none print:shadow-none print:block"
        >
          {/* Header */}
          <div className="p-6 border-b border-border flex justify-between items-center bg-secondary/30 print:hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                <FileText size={20} />
              </div>
              <div>
                <h2 className="text-xl font-heading font-bold text-foreground">Relatório de Cotações</h2>
                <p className="text-sm text-muted">Visão geral e mapa de preços de fornecedores</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Download size={16} />
                Exportar PDF
              </button>
              <button
                onClick={onClose}
                className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Print Only Header */}
          <div className="hidden print:block p-8 border-b-2 border-foreground mb-6">
            <h1 className="text-3xl font-heading font-bold text-foreground mb-2">Relatório de Cotações e Compras</h1>
            <p className="text-muted">Gerado em: {new Date().toLocaleDateString('pt-BR')}</p>
          </div>

          <div className="p-6 overflow-y-auto custom-scrollbar flex-1 print:overflow-visible print:p-8">
            
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="p-5 rounded-2xl border border-border bg-background shadow-sm flex flex-col items-center justify-center text-center print:border-foreground/20">
                <Package size={24} className="text-primary mb-2" />
                <span className="text-3xl font-heading font-bold text-foreground">{totalProducts}</span>
                <span className="text-xs font-medium text-muted uppercase tracking-wider mt-1">Produtos Base</span>
              </div>
              
              <div className="p-5 rounded-2xl border border-border bg-background shadow-sm flex flex-col items-center justify-center text-center print:border-foreground/20">
                <Building2 size={24} className="text-foreground mb-2" />
                <span className="text-3xl font-heading font-bold text-foreground">{totalSuppliers}</span>
                <span className="text-xs font-medium text-muted uppercase tracking-wider mt-1">Fornecedores Diferentes</span>
              </div>
              
              <div className="p-5 rounded-2xl border border-border bg-background shadow-sm flex flex-col items-center justify-center text-center print:border-foreground/20">
                <ShoppingCart size={24} className="text-foreground mb-2" />
                <span className="text-3xl font-heading font-bold text-foreground">{productsWithQuotes}</span>
                <span className="text-xs font-medium text-muted uppercase tracking-wider mt-1">Prod. com Cotação</span>
              </div>

              <div className="p-5 rounded-2xl border border-border bg-background shadow-sm flex flex-col items-center justify-center text-center print:border-foreground/20">
                <TrendingDown size={24} className="text-green-500 mb-2" />
                <span className="text-3xl font-heading font-bold text-foreground">{coveragePercentage.toFixed(0)}%</span>
                <span className="text-xs font-medium text-muted uppercase tracking-wider mt-1">Cobertura de Preços</span>
              </div>
            </div>

            {/* Most Quoted Insight */}
            {mostQuotedProduct && mostQuotedProduct.suppliers.length > 0 && (
              <div className="mb-8 p-5 bg-foreground/10 border border-foreground/20 rounded-2xl print:bg-transparent print:border-foreground/20">
                <h3 className="text-sm font-bold text-foreground mb-1">Maior Variedade de Ofertas</h3>
                <p className="text-sm text-foreground/80">
                  O produto <strong>{mostQuotedProduct.name}</strong> possui o maior número de cotações ({mostQuotedProduct.suppliers.length} fornecedores). 
                  Ter múltiplas opções ajuda a negociar melhores preços.
                </p>
              </div>
            )}

            {/* Detailed Table */}
            <div className="print:break-inside-auto">
              <h3 className="text-lg font-heading font-bold text-foreground mb-4 print:break-after-avoid">Mapa de Melhores Preços (Por Produto)</h3>
              <div className="border border-border rounded-xl overflow-hidden print:border-foreground/20 print:overflow-visible">
                <table className="w-full text-left border-collapse print:break-inside-auto">
                  <thead>
                    <tr className="bg-secondary/30 print:bg-secondary/10">
                      <th className="px-4 py-3 text-xs font-semibold text-muted uppercase">Produto / SKU</th>
                      <th className="px-4 py-3 text-xs font-semibold text-muted uppercase text-center">Qtd. Fornecedores</th>
                      <th className="px-4 py-3 text-xs font-semibold text-muted uppercase">Melhor Fornecedor</th>
                      <th className="px-4 py-3 text-xs font-semibold text-muted uppercase text-right">Melhor Preço</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {products.map(product => {
                      const bestQuote = product.suppliers.length > 0 
                        ? product.suppliers.reduce((prev, curr) => (prev.price < curr.price ? prev : curr))
                        : null;

                      return (
                        <tr key={product.id} className="hover:bg-secondary/10 transition-colors print:break-inside-avoid">
                          <td className="px-4 py-3">
                            <p className="font-bold text-sm text-foreground">{product.name}</p>
                            <p className="text-xs text-muted">SKU: {product.sku || 'N/A'}</p>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-block px-2 py-1 bg-secondary rounded text-xs font-medium">
                              {product.suppliers.length}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {bestQuote ? (
                              <span className="text-sm font-medium text-foreground">{bestQuote.supplierName}</span>
                            ) : (
                              <span className="text-xs text-muted italic">Sem cotações</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {bestQuote ? (
                              <span className="text-sm font-bold text-green-500">{formatCurrency(bestQuote.price)}</span>
                            ) : (
                              <span className="text-xs text-muted">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    
                    {products.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-muted text-sm">
                          Nenhum produto cadastrado para análise.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PurchasingReportModal;
