import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Plus, Clock, MoreVertical } from 'lucide-react';
import { DashboardState } from '../../hooks/useDashboardState';

const DashboardHub = () => {
  const [dashboards, setDashboards] = useState<DashboardState[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Carregar dashboards salvos
    const saved = JSON.parse(localStorage.getItem('saved_dashboards') || '[]');
    setDashboards(saved);
  }, []);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold font-heading">Analytics e Dashboards</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Gerencie e visualize seus painéis de dados gerenciais.</p>
        </div>
        <button 
          onClick={() => navigate('/app/analytics/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors"
        >
          <Plus size={18} />
          Novo Dashboard
        </button>
      </div>

      {dashboards.length === 0 ? (
        <div className="bg-panel border border-border rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <LayoutDashboard size={32} className="text-primary" />
          </div>
          <h2 className="text-xl font-bold mb-2">Nenhum Dashboard Criado</h2>
          <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
            Você ainda não criou nenhum painel de análise. Clique no botão abaixo para começar a explorar seus dados.
          </p>
          <button 
            onClick={() => navigate('/app/analytics/new')}
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-6 py-2.5 rounded-xl font-medium inline-flex items-center gap-2 transition-colors"
          >
            <Plus size={18} />
            Criar Meu Primeiro Dashboard
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {dashboards.map(dashboard => (
            <Link 
              key={dashboard.id}
              to={`/app/analytics/${dashboard.id}`}
              className="bg-panel border border-border rounded-xl p-5 hover:border-primary/50 hover:shadow-md transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
                  <LayoutDashboard size={20} className={dashboards.length % 2 === 0 ? 'text-primary group-hover:text-white' : 'text-primary group-hover:text-white'} />
                </div>
                <button className="text-slate-400 hover:text-foreground">
                  <MoreVertical size={16} />
                </button>
              </div>
              <h3 className="font-semibold text-lg mb-1 truncate">{dashboard.title}</h3>
              <div className="flex items-center text-xs text-slate-500 dark:text-slate-400 mt-4">
                <Clock size={14} className="mr-1" />
                Atualizado em {new Date(dashboard.lastModified).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardHub;
