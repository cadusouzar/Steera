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

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

interface ChartRendererProps {
  type: WidgetType;
  title: string;
}

export const ChartRenderer: React.FC<ChartRendererProps> = ({ type }) => {
  if (type === 'kpi-card') {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <span className="text-4xl font-bold font-heading text-primary">R$ 14.500</span>
        <span className="text-sm text-green-500 font-medium mt-2">+12% vs mês anterior</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      {(() => {
        switch (type) {
          case 'bar-chart':
            return (
              <BarChart data={MOCK_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis axisLine={false} tickLine={false} fontSize={12} />
                <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            );
          case 'line-chart':
            return (
              <LineChart data={MOCK_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis axisLine={false} tickLine={false} fontSize={12} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
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
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              </PieChart>
            );
          default:
            return <div>Tipo desconhecido</div>;
        }
      })()}
    </ResponsiveContainer>
  );
};
