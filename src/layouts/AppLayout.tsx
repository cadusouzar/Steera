import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTheme } from '../components/ThemeProvider';
import { Users, Briefcase, BarChart3, TrendingUp, Settings, LogOut, Moon, Sun, LayoutDashboard, HeartHandshake } from 'lucide-react';

const AppLayout = () => {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-background flex transition-colors duration-300">
      
      {/* Sidebar (ERP Shell) */}
      <aside className="w-64 border-r border-border bg-panel hidden md:flex flex-col">
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
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-colors ${
              isActive('/app') ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <LayoutDashboard size={18} />
            Visão Geral
          </Link>
          <Link 
            to="/app/clientes" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-colors ${
              isActive('/app/clientes') ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <HeartHandshake size={18} />
            Clientes
          </Link>
          
          <Link 
            to="/app/funcionarios" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-colors ${
              isActive('/app/funcionarios') || isActive('/app/funcionarios/novo') ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Users size={18} />
            Funcionários
          </Link>

          <Link 
            to="/app/cargos" 
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-colors ${
              isActive('/app/cargos') ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Briefcase size={18} />
            Cargos
          </Link>
          
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors">
            <TrendingUp size={18} />
            Logística
          </a>
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors">
            <BarChart3 size={18} />
            Finanças
          </a>
        </nav>
        
        <div className="p-4 border-t border-border space-y-1">
          <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors">
            <Settings size={18} />
            Configurações
          </a>
          <Link to="/" className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-red-500 hover:bg-red-500/10 transition-colors">
            <LogOut size={18} />
            Sair
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-border bg-panel flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4">
            <div className="md:hidden w-8 h-8 rounded bg-primary flex items-center justify-center font-heading font-bold text-white text-sm">
              Q
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleTheme}
              className="p-2 text-muted hover:text-foreground hover:bg-secondary/50 rounded-full transition-colors"
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-accent border-2 border-background" />
          </div>
        </header>

        {/* Dynamic Route Content */}
        <div className="flex-1 overflow-auto bg-background/50">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
