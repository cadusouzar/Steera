import React, { useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Settings, Download, Trash2 } from 'lucide-react';
import { DataSidebar } from '../../components/analytics/DataSidebar';
import { WidgetCanvas } from '../../components/analytics/WidgetCanvas';
import { useDashboardState, WidgetType } from '../../hooks/useDashboardState';

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const DashboardBuilder = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { 
    dashboard, 
    addWidget, 
    updateWidgetPosition,
    updateWidget,
    deleteWidget,
    saveDashboard, 
    setDashboard,
    selectedWidgetId,
    setSelectedWidgetId
  } = useDashboardState(id);
  
  const printRef = useRef<HTMLDivElement>(null);

  const handleDropWidget = (type: string, position: {x: number, y: number}) => {
    addWidget({
      id: Math.random().toString(36).substring(2, 9),
      type: type as WidgetType,
      position: { x: position.x, y: position.y, w: type === 'kpi-card' ? 3 : 4, h: type === 'kpi-card' ? 2 : 4 },
      data: { metric: 'mock' },
      title: type === 'kpi-card' ? 'Nova Métrica' : 'Novo Gráfico'
    });
  };

  const handleLayoutChange = (layout: any[]) => {
    layout.forEach(l => {
      updateWidgetPosition(l.i, { x: l.x, y: l.y, w: l.w, h: l.h });
    });
  };

  const handleSave = () => {
    const savedId = saveDashboard();
    if (id === 'new') {
      navigate(`/app/analytics/${savedId}`, { replace: true });
    } else {
      alert('Dashboard salvo com sucesso!');
    }
  };

  const handleExportPDF = async () => {
    if (!printRef.current) return;
    
    try {
      const canvas = await html2canvas(printRef.current, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });
      
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`${dashboard.title || 'dashboard'}.pdf`);
    } catch (error) {
      console.error('Erro ao exportar PDF', error);
      alert('Ocorreu um erro ao exportar o relatório.');
    }
  };

  const selectedWidget = dashboard.widgets.find(w => w.id === selectedWidgetId);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Topbar do Builder */}
      <header className="h-14 border-b border-border bg-panel flex items-center justify-between px-4 shrink-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/app/analytics')}
            className="p-2 hover:bg-secondary/50 rounded-lg text-slate-500 hover:text-foreground transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          
          <input 
            type="text" 
            value={dashboard.title}
            onChange={(e) => setDashboard(prev => ({...prev, title: e.target.value}))}
            className="bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-primary rounded px-2 py-1 font-semibold text-lg hover:bg-secondary/30 transition-colors"
            placeholder="Nome do Dashboard"
          />
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-secondary/50 rounded-lg transition-colors"
          >
            <Download size={16} />
            Exportar PDF
          </button>
          <button 
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium bg-primary text-white hover:bg-primary/90 rounded-lg transition-colors"
          >
            <Save size={16} />
            Salvar
          </button>
        </div>
      </header>

      {/* Área de Trabalho */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Esquerda: Campos de Dados */}
        <DataSidebar />

        {/* Centro: Canvas de Widgets */}
        <div className="flex-1 overflow-auto bg-secondary/10" ref={printRef}>
          <WidgetCanvas 
            widgets={dashboard.widgets} 
            onDropWidget={handleDropWidget} 
            onLayoutChange={handleLayoutChange}
            selectedWidgetId={selectedWidgetId}
            onSelectWidget={setSelectedWidgetId}
          />
        </div>

        {/* Sidebar Direita: Propriedades Visuais */}
        {selectedWidgetId ? (
          <aside className="w-72 bg-panel border-l border-border h-full p-5 flex flex-col z-10 overflow-y-auto shadow-[-4px_0_15px_rgba(0,0,0,0.05)]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-semibold text-lg flex items-center gap-2">
                <Settings size={18} className="text-primary" />
                Propriedades
              </h2>
              <button 
                onClick={() => deleteWidget(selectedWidgetId)}
                className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Remover gráfico"
              >
                <Trash2 size={16} />
              </button>
            </div>
            
            {selectedWidget && (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">Título do Gráfico</label>
                  <input 
                    type="text"
                    value={selectedWidget.title}
                    onChange={(e) => updateWidget(selectedWidget.id, { title: e.target.value })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">Tipo de Visualização</label>
                  <select 
                    value={selectedWidget.type}
                    onChange={(e) => updateWidget(selectedWidget.id, { type: e.target.value as WidgetType })}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="kpi-card">Cartão (KPI)</option>
                    <option value="bar-chart">Gráfico de Barras</option>
                    <option value="line-chart">Gráfico de Linhas</option>
                    <option value="donut-chart">Gráfico de Rosca (Donut)</option>
                  </select>
                </div>
                
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg mt-8">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Nesta área futura, o usuário poderá arrastar dimensões e métricas diretamente para os eixos X e Y deste gráfico específico, além de alterar paletas de cores.
                  </p>
                </div>
              </div>
            )}
          </aside>
        ) : (
          <aside className="w-16 border-l border-border bg-panel hidden lg:flex flex-col items-center py-4 cursor-pointer hover:bg-secondary/50 transition-colors" onClick={() => {}}>
            <Settings size={20} className="text-slate-400" />
            <div className="[writing-mode:vertical-lr] rotate-180 mt-6 text-xs tracking-widest text-slate-400 font-medium uppercase">
              Propriedades
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default DashboardBuilder;
