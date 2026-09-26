import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useTheme } from '../components/ThemeProvider';
import ThemeToggle from '../components/ThemeToggle';
import UserProfileDropdown from '../components/UserProfileDropdown';
import UserProfileDrawer from '../components/UserProfileDrawer';
import LockedNavItem from '../components/LockedNavItem';
import PlanUpgradeNotice from '../components/PlanUpgradeNotice';
import { getCurrentUser } from '../lib/auth';
import { Users, BarChart3, TrendingUp, LayoutDashboard, HeartHandshake, ChevronDown, Package, Shield, Settings } from 'lucide-react';

// Espelha FEATURE_LABELS do backend (backend/src/plans/plan-catalog.ts) — usado só pro rótulo da
// tela de upgrade (PlanUpgradeNotice) quando uma rota travada pelo plano é aberta direto pela URL.
const FEATURE_LABELS: Record<string, string> = {
  DASHBOARD: 'Visão Geral',
  CLIENTES: 'Clientes',
  RH_CARGOS: 'Cargos',
  RH_FUNCIONARIOS: 'Funcionários',
  PONTO_REGISTRO: 'Ponto',
  PONTO_ADMINISTRACAO: 'Administração do Ponto',
  COMERCIAL: 'Comercial',
  OPERACOES: 'Operações',
  FINANCAS: 'Finanças',
  ANALYTICS: 'Analytics e Dashboards',
};

// Mapa de prefixo de rota → item de plano (módulo/recurso) que a protege — checado do mais
// específico pro mais genérico (ex.: /app/ponto-administracao antes de /app/ponto, que também
// bateria por prefixo). Usado só pra decidir se a rota ATUAL está travada pelo plano (Task 6,
// 26/09/2026) — a fronteira de segurança real é o PlanGuard no backend.
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function lockedItemForPath(pathname: string): string | null {
  if (matchesPrefix(pathname, '/app/ponto-administracao')) return 'PONTO_ADMINISTRACAO';
  if (matchesPrefix(pathname, '/app/ponto')) return 'PONTO_REGISTRO';
  if (matchesPrefix(pathname, '/app/orcamentos')) return 'COMERCIAL';
  if (matchesPrefix(pathname, '/app/estoque') || matchesPrefix(pathname, '/app/compras')) return 'OPERACOES';
  if (matchesPrefix(pathname, '/app/financas')) return 'FINANCAS';
  if (matchesPrefix(pathname, '/app/analytics')) return 'ANALYTICS';
  return null;
}

// Espelha o enum `AppModule` do backend (backend/prisma/schema.prisma) — os valores já chegam em
// maiúsculo de getCurrentUser()?.modules (vindos direto de /auth/login, /auth/me e do refresh),
// sem precisar de normalização. `RH` sozinho nunca é mais atribuído a um login novo (17/09/2026) —
// RH virou RH_CARGOS/RH_FUNCIONARIOS, e Ponto virou um menu próprio (PONTO_REGISTRO/
// PONTO_ADMINISTRACAO), independente de RH. Mantido no tipo só pra não quebrar um login antigo que
// ainda carregue esse valor num token já emitido — nenhum `hasModule('RH')` é mais usado abaixo.
type AppModule =
  | 'DASHBOARD' | 'CLIENTES' | 'RH' | 'RH_CARGOS' | 'RH_FUNCIONARIOS'
  | 'PONTO_REGISTRO' | 'PONTO_ADMINISTRACAO' | 'COMERCIAL' | 'OPERACOES' | 'FINANCAS';

const AppLayout = () => {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const currentUser = getCurrentUser();

  // Filtro de navegação por módulo: convenção de UI apenas (esconde links
  // que o usuário não tem em `modules`) — não é a fronteira de segurança
  // real, que já é garantida pelo backend (Tasks 4-7) e pelo RequireAuth
  // (Task 9). Regra deliberada do plano: módulos valem igualmente para
  // ADMIN e EMPLOYEE — nenhum bypass aqui pra `role === 'ADMIN'`.
  const userModules = currentUser?.modules ?? [];
  const hasModule = (module: AppModule) => userModules.includes(module);
  const isAdmin = currentUser?.role === 'admin';

  // Cadeado por plano (Task 6, 26/09/2026): módulo/recurso que o PERFIL do login concede mas o
  // PLANO da empresa não inclui — ver UserPlan em src/lib/auth.ts. `null`/empresa sem info de
  // plano nunca trava nada (currentUser?.plan?.locked ?? {}).
  const locked = currentUser?.plan?.locked ?? {};
  const lockOf = (item: string) => locked[item];

  const lockedRouteItem = lockedItemForPath(location.pathname);
  const lockedRoute = lockedRouteItem ? lockOf(lockedRouteItem) : undefined;

  const isActive = (path: string) => path === '/app' ? location.pathname === '/app' : (location.pathname === path || location.pathname.startsWith(`${path}/`));

  // State for submenus
  const [isHrOpen, setIsHrOpen] = useState(false);
  const [isPontoOpen, setIsPontoOpen] = useState(false);
  const [isOperationsOpen, setIsOperationsOpen] = useState(false);
  const [isCommercialOpen, setIsCommercialOpen] = useState(false);
  
  // State for profile drawer
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Auto-open submenu if active route is inside it
  useEffect(() => {
    if (location.pathname.startsWith('/app/funcionarios') || location.pathname.startsWith('/app/cargos')) {
      setIsHrOpen(true);
    }
    // `startsWith('/app/ponto')` já cobre /app/ponto-administracao também (prefixo de string) —
    // sem precisar de uma condição separada. Ponto virou um submenu próprio, independente de RH
    // (17/09/2026).
    if (location.pathname.startsWith('/app/ponto')) {
      setIsPontoOpen(true);
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
          
          {hasModule('DASHBOARD') && (
            <Link
              to="/app"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                isActive('/app') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <LayoutDashboard size={18} />
              Visão Geral
            </Link>
          )}
          {hasModule('CLIENTES') && (
            <Link
              to="/app/clientes"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                isActive('/app/clientes') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <HeartHandshake size={18} />
              Clientes
            </Link>
          )}

          {/* Recursos Humanos Submenu — só Cargos/Funcionários desde 17/09/2026 (Ponto virou um
              menu próprio, independente, logo abaixo) */}
          {(hasModule('RH_CARGOS') || hasModule('RH_FUNCIONARIOS')) && (
          <div className="space-y-1">
            <button
              onClick={() => setIsHrOpen(!isHrOpen)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                (isActive('/app/funcionarios') || isActive('/app/cargos'))
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

            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isHrOpen ? 'max-h-24 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
              <div className="pl-11 pr-2 space-y-1">
                {hasModule('RH_FUNCIONARIOS') && (
                <Link
                  to="/app/funcionarios"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/funcionarios') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Funcionários
                </Link>
                )}
                {hasModule('RH_CARGOS') && (
                <Link
                  to="/app/cargos"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/cargos') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Cargos
                </Link>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Ponto Submenu (novo em 17/09/2026, independente de Recursos Humanos) — "Controle de
              Ponto" (bater o próprio ponto) e "Administração de Ponto" (aprovar ajustes/
              justificativas de outros, escalas, feriados, configuração) são módulos
              INDEPENDENTES: dá pra conceder um sem o outro, ex. um login que só bate o próprio
              ponto, sem enxergar a administração. */}
          {(hasModule('PONTO_REGISTRO') || hasModule('PONTO_ADMINISTRACAO')) && (
            lockOf('PONTO_REGISTRO') && lockOf('PONTO_ADMINISTRACAO') ? (
              <LockedNavItem icon={Users} label="Ponto" planLabel={lockOf('PONTO_REGISTRO')!.label} />
            ) : (
          <div className="space-y-1">
            <button
              onClick={() => setIsPontoOpen(!isPontoOpen)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                (isActive('/app/ponto') || isActive('/app/ponto-administracao'))
                  ? 'bg-primary/5 text-primary'
                  : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Users size={18} />
                Ponto
              </div>
              <ChevronDown size={16} className={`transition-transform duration-300 ${isPontoOpen ? 'rotate-180' : ''}`} />
            </button>

            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isPontoOpen ? 'max-h-40 opacity-100 mt-1' : 'max-h-0 opacity-0'}`}>
              <div className="pl-11 pr-2 space-y-1">
                {hasModule('PONTO_REGISTRO') && (
                <Link
                  to="/app/ponto"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/ponto') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Controle de Ponto
                </Link>
                )}
                {hasModule('PONTO_ADMINISTRACAO') && (
                <Link
                  to="/app/ponto-administracao"
                  className={`block px-3 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    isActive('/app/ponto-administracao') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                  }`}
                >
                  Administração de Ponto
                </Link>
                )}
              </div>
            </div>
          </div>
            )
          )}

          {/* Comercial Submenu */}
          {hasModule('COMERCIAL') && (
            lockOf('COMERCIAL') ? (
              <LockedNavItem icon={TrendingUp} label="Comercial" planLabel={lockOf('COMERCIAL')!.label} />
            ) : (
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
            )
          )}

          {/* Operações Submenu */}
          {hasModule('OPERACOES') && (
            lockOf('OPERACOES') ? (
              <LockedNavItem icon={Package} label="Operações" planLabel={lockOf('OPERACOES')!.label} />
            ) : (
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
            )
          )}
          {hasModule('FINANCAS') && (
            lockOf('FINANCAS') ? (
              <LockedNavItem icon={BarChart3} label="Finanças" planLabel={lockOf('FINANCAS')!.label} />
            ) : (
          <Link
            to="/app/financas"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
              isActive('/app/financas') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <BarChart3 size={18} />
            Finanças
          </Link>
            )
          )}

          {hasModule('DASHBOARD') && (
            lockOf('ANALYTICS') ? (
              <LockedNavItem icon={LayoutDashboard} label="Analytics e Dashboards" planLabel={lockOf('ANALYTICS')!.label} />
            ) : (
          <Link
            to="/app/analytics"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
              isActive('/app/analytics') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <LayoutDashboard size={18} />
            Analytics e Dashboards
          </Link>
            )
          )}

          {/* Seção Administração — achado num teste manual do usuário (17/09/2026): estava
              aparecendo pra QUALQUER login autenticado, inclusive EMPLOYEE, mesmo o backend já
              exigindo @Roles('ADMIN') pra qualquer ação de escrita nas duas telas. Gateada por
              role agora (não por módulo — gerenciar logins/campos personalizados nunca foi uma
              questão de módulo, sempre foi admin-only). */}
          {isAdmin && (
            <>
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

              <Link
                to="/app/perfis"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                  isActive('/app/perfis') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Shield size={18} />
                Perfis de Acesso
              </Link>

              <Link
                to="/app/campos-personalizados"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                  isActive('/app/campos-personalizados') ? 'bg-primary/10 text-primary' : 'text-slate-500 dark:text-slate-400 hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                <Settings size={18} />
                Campos Personalizados
              </Link>
            </>
          )}
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
          {lockedRoute ? (
            <PlanUpgradeNotice
              featureLabel={FEATURE_LABELS[lockedRouteItem as string] ?? (lockedRouteItem as string)}
              planLabel={lockedRoute.label}
            />
          ) : (
            <Outlet />
          )}
        </div>
      </main>

      {/* User Profile Drawer */}
      {isProfileOpen && <UserProfileDrawer onClose={() => setIsProfileOpen(false)} />}
    </div>
  );
};

export default AppLayout;
