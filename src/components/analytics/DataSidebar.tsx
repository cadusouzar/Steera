import React from 'react';
import { Database, Calendar, Tag, DollarSign, Users, MapPin, TrendingUp, Search } from 'lucide-react';

export const DataSidebar: React.FC = () => {
  const metrics = [
    { id: 'receita', name: 'Receita Total', icon: <DollarSign size={16} /> },
    { id: 'vendas', name: 'Qtd Vendas', icon: <Tag size={16} /> },
    { id: 'clientes', name: 'Novos Clientes', icon: <Users size={16} /> },
    { id: 'ticket_medio', name: 'Ticket Médio', icon: <TrendingUp size={16} /> },
  ];

  const dimensions = [
    { id: 'data', name: 'Por Data (Mês/Ano)', icon: <Calendar size={16} /> },
    { id: 'categoria', name: 'Por Categoria', icon: <Database size={16} /> },
    { id: 'regiao', name: 'Por Região', icon: <MapPin size={16} /> },
  ];

  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('widgetType', type);
  };

  return (
    <aside className="w-64 bg-panel border-r border-border h-full flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Database size={18} className="text-primary" />
          Dados
        </h2>
        <div className="mt-4 relative">
          <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted" />
          <input 
            type="text" 
            placeholder="Buscar campos..." 
            className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Métricas (Números)</h3>
          <div className="space-y-2">
            {metrics.map(metric => (
              <div 
                key={metric.id}
                draggable
                onDragStart={(e) => handleDragStart(e, 'kpi-card')}
                className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2 text-sm cursor-grab active:cursor-grabbing hover:border-primary/50 hover:bg-primary/5 transition-colors"
              >
                <div className="text-primary/70">{metric.icon}</div>
                <span>{metric.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Dimensões (Agrupamentos)</h3>
          <div className="space-y-2">
            {dimensions.map(dim => (
              <div 
                key={dim.id}
                draggable
                onDragStart={(e) => handleDragStart(e, 'bar-chart')} // Simplificando para gerar barras ao soltar
                className="flex items-center gap-2 bg-background border border-border rounded-lg px-3 py-2 text-sm cursor-grab active:cursor-grabbing hover:border-foreground/50 hover:bg-foreground/5 transition-colors"
              >
                <div className="text-foreground/70">{dim.icon}</div>
                <span>{dim.name}</span>
              </div>
            ))}
          </div>
        </div>
        
        <div className="p-3 bg-secondary/30 rounded-lg border border-border/50 text-xs text-muted">
          <p>💡 Arraste as métricas para a área central (Canvas) para criar gráficos automaticamente.</p>
        </div>
      </div>
    </aside>
  );
};
