import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTheme } from '../components/ThemeProvider';
import ThemeToggle from '../components/ThemeToggle';
import UserProfileDropdown from '../components/UserProfileDropdown';
import UserProfileDrawer from '../components/UserProfileDrawer';
import { Users, BarChart3, TrendingUp, LayoutDashboard, HeartHandshake, ChevronDown, Package, Shield } from 'lucide-react';

const AppLayout = () => {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const isActive = (path: string) => path === '/app' ? location.pathname === '/app' : (location.pathname === path || location.pathname.startsWith(`${path}/`));

  // State for submenus
  const [isHrOpen, setIsHrOpen] = useState(false);
  const [isOperationsOpen, setIsOperationsOpen] = useState(false);
  const [isCommercialOpen, setIsCommercialOpen] = useState(false);
  
  // State for profile drawer
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Auto-open submenu if active route is inside it
  useEffect(() => {
    if (location.pathname.startsWith('/app/funcionarios') || location.pathname.startsWith('/app/cargos') || location.pathname.startsWith('/app/ponto')) {
      setIsHrOpen(true);
    }
    if (location.pathname.startsWith('/app/estoque') || location.pathname.startsWith('/app/compras')) {
      setIsOperationsOpen(true);
    }
    if (location.pathname.startsWith('/app/orcamentos')) {
      setIsCommercialOpen(true);
    }
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background flex transition-colors duration-300">
      
      {/* Sidebar (ERP Shell) */}
      <aside className="w-64 border-r border-border bg-panel hidden md:flex flex-col transition-colors duration-300">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center font-heading font-bold text-white text-xs mr-2">
            Q
          </div>
          <span className="font-heading font-bold text-foreground">QuickFlow</span>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-1">
          <div className="text-xs font-semibold text-muted uppercase tracking-wider mb-4 px-2">Módulos</div>
          
          <Link 
            to="/app" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
              isActive('/app') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <LayoutDashboard size={18} />
            Visão Geral
          </Link>
          <Link 
            to="/app/clientes" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
              isActive('/app/clientes') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <HeartHandshake size={18} />
            Clientes
          </Link>
          
          {/* Recursos Humanos Submenu */}
          <div className="space-y-1">
            <button 
              onClick={() => setIsHrOpen(!isHrOpen)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                (isActive('/app/funcionarios') || isActive('/app/cargos') || isActive('/app/ponto')) 
                  ? 'bg-primary/5 text-primary' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Users size={18} />
                Recursos Humanos
              </div>
              <ChevronDown size={16} className={`transition-transform duration-300 ${isHrOpen ? 'rotate-180' : ''}`} />
            </button>
            
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isHrOpen ? 'max-h-40 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
              <div className="pl-11 pr-2 space-y-1">
                <Link 
                  to="/app/funcionarios" 
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/funcionarios') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Funcionários
                </Link>
                <Link 
                  to="/app/cargos" 
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/cargos') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Cargos
                </Link>
                <Link 
                  to="/app/ponto" 
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/ponto') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Controle de Ponto
                </Link>
              </div>
            </div>
          </div>

          {/* Comercial Submenu */}
          <div className="space-y-1">
            <button 
              onClick={() => setIsCommercialOpen(!isCommercialOpen)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                (isActive('/app/orcamentos')) 
                  ? 'bg-primary/5 text-primary' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <TrendingUp size={18} />
                Comercial
              </div>
              <ChevronDown size={16} className={`transition-transform duration-300 ${isCommercialOpen ? 'rotate-180' : ''}`} />
            </button>
            
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isCommercialOpen ? 'max-h-40 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
              <div className="pl-11 pr-2 space-y-1">
                <Link 
                  to="/app/orcamentos" 
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/orcamentos') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Orçamentos
                </Link>
              </div>
            </div>
          </div>

          {/* Operações Submenu */}
          <div className="space-y-1">
            <button 
              onClick={() => setIsOperationsOpen(!isOperationsOpen)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                (isActive('/app/estoque') || isActive('/app/compras')) 
                  ? 'bg-primary/5 text-primary' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Package size={18} />
                Operações
              </div>
              <ChevronDown size={16} className={`transition-transform duration-300 ${isOperationsOpen ? 'rotate-180' : ''}`} />
            </button>
            
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isOperationsOpen ? 'max-h-40 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
              <div className="pl-11 pr-2 space-y-1">
                <Link 
                  to="/app/estoque" 
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/estoque') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Estoque
                </Link>
                <Link 
                  to="/app/compras" 
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/compras') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Compras / Cotações
                </Link>
                <a href="#" className="block px-3 py-2 rounded-lg text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50 transition-all duration-300">
                  Logística
                </a>
              </div>
            </div>
          </div>
          <Link 
            to="/app/financas" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
              isActive('/app/financas') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <BarChart3 size={18} />
            Finanças
          </Link>

          <Link 
            to="/app/analytics" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
              isActive('/app/analytics') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <LayoutDashboard size={18} />
            Analytics e Dashboards
          </Link>

          <div className="text-xs font-semibold text-muted uppercase tracking-wider mt-8 pt-6 border-t border-border/40 mb-4 px-2">Administração</div>
          
          <Link 
            to="/app/usuarios" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
              isActive('/app/usuarios') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Shield size={18} />
            Usuários e Acessos
          </Link>
        </nav>
        

      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-border bg-panel flex items-center justify-between px-6 z-10 transition-colors duration-300">
          <div className="flex items-center gap-4">
            <div className="md:hidden w-8 h-8 rounded bg-primary flex items-center justify-center font-heading font-bold text-white text-sm">
              Q
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
            <UserProfileDropdown onOpenProfile={() => setIsProfileOpen(true)} />
          </div>
        </header>

        {/* Dynamic Route Content */}
        <div className="flex-1 overflow-auto bg-background/50">
          <Outlet />
        </div>
      </main>

      {/* User Profile Drawer */}
      {isProfileOpen && <UserProfileDrawer onClose={() => setIsProfileOpen(false)} />}
    </div>
  );
};

export default AppLayout;
