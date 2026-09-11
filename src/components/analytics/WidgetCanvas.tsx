import React from 'react';
import { WidgetConfig } from '../../hooks/useDashboardState';
import { ChartRenderer } from './ChartRenderer';
import { ResponsiveGridLayout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { BarChart3 } from 'lucide-react';

// react-grid-layout's shipped types omit isDraggable/isResizable from ResponsiveGridLayoutProps
// even though the runtime component honors them — cast narrowly to the component only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GridLayout = ResponsiveGridLayout as any;

interface WidgetCanvasProps {
  widgets: WidgetConfig[];
  onDropWidget?: (type: string, position: {x: number, y: number}) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onLayoutChange?: (layout: readonly any[]) => void;
  selectedWidgetId?: string | null;
  onSelectWidget?: (id: string) => void;
}

export const WidgetCanvas: React.FC<WidgetCanvasProps> = ({ 
  widgets, 
  onDropWidget, 
  onLayoutChange,
  selectedWidgetId,
  onSelectWidget
}) => {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('widgetType');
    if (type && onDropWidget) {
      onDropWidget(type, { x: 0, y: Infinity }); // Adding to the bottom
    }
  };

  // Convert our WidgetConfig to react-grid-layout format
  const layout: any[] = widgets.map(w => ({
    i: w.id,
    x: w.position.x,
    y: w.position.y,
    w: w.position.w,
    h: w.position.h,
    minW: 2,
    minH: 2
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleLayoutChangeCallback = (newLayout: readonly any[]) => onLayoutChange && onLayoutChange(newLayout);

  return (
    <div 
      className="flex-1 bg-secondary/10 overflow-auto relative p-4"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => onSelectWidget && onSelectWidget('')} // Click outside deselects
    >
      {widgets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
          <BarChart3 size={48} className="mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-slate-300">Canvas Vazio</h3>
          <p className="text-sm">Arraste métricas da barra lateral para começar a construir seu dashboard.</p>
        </div>
      ) : (
        <GridLayout
          className="layout"
          layouts={{ lg: layout }}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={100}
          onLayoutChange={handleLayoutChangeCallback}
          isDraggable={true}
          isResizable={true}
          margin={[16, 16]}
        >
          {widgets.map((widget) => (
            <div
              key={widget.id}
              className={`bg-panel border rounded-xl p-4 shadow-sm flex flex-col group transition-colors ${selectedWidgetId === widget.id ? 'border-primary ring-1 ring-primary/50' : 'border-border hover:border-border/80'}`}
              onClick={(e) => {
                e.stopPropagation();
                if (onSelectWidget) onSelectWidget(widget.id);
              }}
            >
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border/50 cursor-grab active:cursor-grabbing">
                <h4 className="font-medium text-sm flex-1 truncate">{widget.title}</h4>
              </div>
              <div className="flex-1 w-full h-full min-h-0">
                <ChartRenderer type={widget.type} title={widget.title} />
              </div>
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
};
