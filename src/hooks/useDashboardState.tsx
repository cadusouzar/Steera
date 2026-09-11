import { useState, useEffect } from 'react';

// Tipos simplificados para o estado inicial
export type WidgetType = 'kpi-card' | 'bar-chart' | 'line-chart' | 'donut-chart';

export interface WidgetData {
  metric?: string;
  dimension?: string;
  // Widget-specific config bag: shape varies per WidgetType (chart axes, colors, filters, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  position: { x: number; y: number; w: number; h: number };
  data: WidgetData;
  title: string;
}

export interface DashboardState {
  id: string;
  title: string;
  layout: string;
  widgets: WidgetConfig[];
  lastModified: string;
}

const MOCK_INITIAL_STATE: DashboardState = {
  id: 'new',
  title: 'Meu Novo Dashboard',
  layout: 'grid',
  widgets: [],
  lastModified: new Date().toISOString()
};

export const useDashboardState = (dashboardId: string = 'new') => {
  const [dashboard, setDashboard] = useState<DashboardState>(MOCK_INITIAL_STATE);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);

  useEffect(() => {
    const savedDashboards = JSON.parse(localStorage.getItem('saved_dashboards') || '[]');
    const existing = savedDashboards.find((d: DashboardState) => d.id === dashboardId);
    
    if (existing) {
      setDashboard(existing);
    } else if (dashboardId === 'new') {
      setDashboard({
        ...MOCK_INITIAL_STATE,
        widgets: [],
        lastModified: new Date().toISOString()
      });
      setSelectedWidgetId(null);
    }
  }, [dashboardId]);

  const addWidget = (widget: WidgetConfig) => {
    setDashboard(prev => ({
      ...prev,
      widgets: [...prev.widgets, widget],
      lastModified: new Date().toISOString()
    }));
    setSelectedWidgetId(widget.id); // Select the newly added widget
  };

  const updateWidgetPosition = (id: string, position: WidgetConfig['position']) => {
    setDashboard(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => w.id === id ? { ...w, position } : w),
      lastModified: new Date().toISOString()
    }));
  };
  
  const updateWidget = (id: string, updates: Partial<WidgetConfig>) => {
    setDashboard(prev => ({
      ...prev,
      widgets: prev.widgets.map(w => w.id === id ? { ...w, ...updates } : w),
      lastModified: new Date().toISOString()
    }));
  };

  const deleteWidget = (id: string) => {
    setDashboard(prev => ({
      ...prev,
      widgets: prev.widgets.filter(w => w.id !== id),
      lastModified: new Date().toISOString()
    }));
    if (selectedWidgetId === id) setSelectedWidgetId(null);
  };

  const saveDashboard = () => {
    const savedDashboards = JSON.parse(localStorage.getItem('saved_dashboards') || '[]');
    const newDashboards = savedDashboards.filter((d: DashboardState) => d.id !== dashboard.id);
    
    // Se for um novo, gera um ID
    const dashboardToSave = {
      ...dashboard,
      id: dashboard.id === 'new' ? Math.random().toString(36).substring(2, 9) : dashboard.id,
      lastModified: new Date().toISOString()
    };

    newDashboards.push(dashboardToSave);
    localStorage.setItem('saved_dashboards', JSON.stringify(newDashboards));
    return dashboardToSave.id;
  };

  return {
    dashboard,
    addWidget,
    updateWidgetPosition,
    updateWidget,
    deleteWidget,
    saveDashboard,
    setDashboard,
    selectedWidgetId,
    setSelectedWidgetId
  };
};
