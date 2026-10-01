import React from 'react';
import { 
  BarChart, Bar, 
  LineChart, Line, 
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { WidgetType } from '../../hooks/useDashboardState';

const MOCK_DATA = [
  { name: 'Jan', value: 4000, value2: 2400 },
  { name: 'Fev', value: 3000, value2: 1398 },
  { name: 'Mar', value: 2000, value2: 9800 },
  { name: 'Abr', value: 2780, value2: 3908 },
  { name: 'Mai', value: 1890, value2: 4800 },
  { name: 'Jun', value: 2390, value2: 3800 },
];

// Paleta monocromática: tudo em `currentColor` (o wrapper usa text-foreground, então segue o tema
// claro/escuro sozinho); as fatias do donut se distinguem por opacidade, não por matiz.
const SLICE_OPACITY = [1, 0.62, 0.38, 0.2];
const TOOLTIP_STYLE = {
  borderRadius: '6px',
  border: '1px solid rgb(var(--border))',
  background: 'rgb(var(--panel))',
  color: 'rgb(var(--foreground))',
  boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.08)',
};

interface ChartRendererProps {
  type: WidgetType;
  title: string;
}

export const ChartRenderer: React.FC<ChartRendererProps> = ({ type }) => {
  if (type === 'kpi-card') {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <span className="text-4xl font-semibold tabular text-foreground">R$ 14.500</span>
        <span className="text-sm text-success font-medium mt-2">+12% vs mês anterior</span>
      </div>
    );
  }

  return (
    <div className="h-full w-full text-foreground">
    <ResponsiveContainer width="100%" height="100%">
      {(() => {
        switch (type) {
          case 'bar-chart':
            return (
              <BarChart data={MOCK_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={12} tick={{ fill: 'rgb(var(--muted))' }} />
                <YAxis axisLine={false} tickLine={false} fontSize={12} tick={{ fill: 'rgb(var(--muted))' }} />
                <Tooltip cursor={{fill: 'transparent'}} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="value" fill="currentColor" radius={[2, 2, 0, 0]} />
              </BarChart>
            );
          case 'line-chart':
            return (
              <LineChart data={MOCK_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={12} tick={{ fill: 'rgb(var(--muted))' }} />
                <YAxis axisLine={false} tickLine={false} fontSize={12} tick={{ fill: 'rgb(var(--muted))' }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line type="linear" dataKey="value" stroke="currentColor" strokeWidth={1.5} dot={false} activeDot={{ r: 4, fill: 'currentColor' }} />
              </LineChart>
            );
          case 'donut-chart':
            return (
              <PieChart>
                <Pie
                  data={MOCK_DATA.slice(0, 4)}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {MOCK_DATA.map((_, index) => (
                    <Cell key={`cell-${index}`} fill="currentColor" fillOpacity={SLICE_OPACITY[index % SLICE_OPACITY.length]} stroke="none" />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            );
          default:
            return <div>Tipo desconhecido</div>;
        }
      })()}
    </ResponsiveContainer>
    </div>
  );
};
