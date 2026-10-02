import { useState, useEffect, useCallback, useMemo } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BriefcaseBusiness, Clock3, HeartHandshake, KeyRound, LayoutGrid, LineChart, Menu, Package,
  ShieldCheck, SlidersHorizontal, Users, Wallet, X,
} from 'lucide-react';
import { useTheme } from '../components/ThemeProvider';
import ThemeToggle from '../components/ThemeToggle';
import UserProfileDropdown from '../components/UserProfileDropdown';
import UserProfileDrawer from '../components/UserProfileDrawer';
import PlanUpgradeNotice from '../components/PlanUpgradeNotice';
import PlanUpgradeModal, { type PlanUpgradeTarget } from '../components/PlanUpgradeModal';
import type { PlanCatalogItem } from '../lib/api';
import { can, useCurrentUser } from '../lib/auth';
import { PLAN_ITEM_LABELS } from '../lib/planCatalog';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { usePontoPendingCount } from '../hooks/usePontoPendingCount';
import AppSidebar, { type NavEntry, type NavGroup, type NavLink, type NavSection } from './AppSidebar';
import SteeraLogo from '../components/brand/SteeraLogo';
import { BRAND_NAME } from '../lib/brand';

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

// Grupo da sidebar que contém cada prefixo de rota — abre sozinho quando a rota atual está dentro dele.
const GROUP_PREFIXES: Record<string, string[]> = {
  rh: ['/app/funcionarios', '/app/cargos'],
  // `/app/ponto` já cobre /app/ponto-administracao (prefixo de string).
  ponto: ['/app/ponto'],
  comercial: ['/app/orcamentos'],
  operacoes: ['/app/estoque', '/app/compras'],
};

// Espelha o enum `AppModule` do backend (backend/prisma/schema.prisma) — os valores já chegam em
// maiúsculo de getCurrentUser()?.modules (vindos direto de /auth/login, /auth/me e do refresh),
// sem precisar de normalização. `RH` sozinho nunca é mais atribuído a um login novo (17/09/2026) —
// RH virou RH_CARGOS/RH_FUNCIONARIOS, e Ponto virou um menu próprio (PONTO_REGISTRO/
// PONTO_ADMINISTRACAO), independente de RH. Mantido no tipo só pra não quebrar um login antigo que
// ainda carregue esse valor num token já emitido — nenhum `hasModule('RH')` é mais usado abaixo.
type AppModule =
  | 'DASHBOARD' | 'CLIENTES' | 'RH' | 'RH_CARGOS' | 'RH_FUNCIONARIOS'
  | 'PONTO_REGISTRO' | 'PONTO_ADMINISTRACAO' | 'COMERCIAL' | 'OPERACOES' | 'FINANCAS';

const BRAND = BRAND_NAME;

const AppLayout = () => {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const currentUser = useCurrentUser();
  const reduceMotion = useReducedMotion();

  // Filtro de navegação por módulo: convenção de UI apenas (esconde links
  // que o usuário não tem em `modules`) — não é a fronteira de segurança
  // real, que já é garantida pelo backend (Tasks 4-7) e pelo RequireAuth
  // (Task 9). Regra deliberada do plano: módulos valem igualmente para
  // ADMIN e EMPLOYEE — nenhum bypass aqui pra `role === 'ADMIN'`.
  const userModules = currentUser?.modules ?? [];
  const hasModule = (module: AppModule) => userModules.includes(module);
  // Permissões por ação (Fase 2b, 27/09/2026): o módulo vem derivado do perfil e acende com QUALQUER
  // permissão da área (ex.: só "Agendar férias" já liga RH_FUNCIONARIOS), mas a listagem exige o
  // `.ver` — então o link da área só aparece com as duas coisas. Cadeado de plano não muda: estes
  // três módulos são do plano Grátis. Administração segue a permissão, não o papel.
  const hasPermission = (code: string) => can(code, currentUser);
  const showClientes = hasModule('CLIENTES') && hasPermission('clientes.ver');
  const showCargos = hasModule('RH_CARGOS') && hasPermission('cargos.ver');
  const showFuncionarios = hasModule('RH_FUNCIONARIOS') && hasPermission('funcionarios.ver');
  const showPontoAdmin = hasModule('PONTO_ADMINISTRACAO') && hasPermission('ponto.administrar');
  const canManageUsers = hasPermission('usuarios.gerenciar');
  const canManageCustomFields = hasPermission('campos-personalizados.gerenciar');

  // Cadeado por plano (Task 6, 26/09/2026): módulo/recurso que o PERFIL do login concede mas o
  // PLANO da empresa não inclui — ver UserPlan em src/lib/auth.ts. `null`/empresa sem info de
  // plano nunca trava nada (currentUser?.plan?.locked ?? {}).
  const locked = currentUser?.plan?.locked ?? {};
  const lockOf = (item: string) => locked[item];

  const lockedRouteItem = lockedItemForPath(location.pathname);
  const lockedRoute = lockedRouteItem ? lockOf(lockedRouteItem) : undefined;

  // Oferta de upgrade aberta por cima da tela atual (clique num item travado ou em "Ver planos" da
  // rota travada) — nunca navega.
  const [upgradeTarget, setUpgradeTarget] = useState<PlanUpgradeTarget | null>(null);
  const closeUpgrade = useCallback(() => setUpgradeTarget(null), []);
  const openUpgrade = (featureLabel: string, item: string) => {
    const lock = lockOf(item);
    if (!lock) return;
    setUpgradeTarget({ featureLabel, requiredTier: lock.tier as PlanCatalogItem['tier'], requiredLabel: lock.label });
  };

  const isActive = useCallback(
    (path: string) => (path === '/app' ? location.pathname === '/app' : matchesPrefix(location.pathname, path)),
    [location.pathname],
  );

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  // Abre sozinho o grupo que contém a rota atual (nunca fecha o que a pessoa abriu).
  useEffect(() => {
    const opened = Object.entries(GROUP_PREFIXES)
      .filter(([, prefixes]) => prefixes.some((p) => location.pathname.startsWith(p)))
      .map(([key]) => key);
    if (opened.length > 0) {
      setOpenGroups((prev) => {
        const next = { ...prev };
        opened.forEach((key) => { next[key] = true; });
        return next;
      });
    }
  }, [location.pathname]);

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const closeMobileNav = useCallback(() => setIsMobileNavOpen(false), []);
  useEscapeKey(closeMobileNav);
  useEffect(() => setIsMobileNavOpen(false), [location.pathname]);

  const pontoPending = usePontoPendingCount(showPontoAdmin && !lockOf('PONTO_ADMINISTRACAO'), location.pathname);

  const sections = useMemo<NavSection[]>(() => {
    const main: NavEntry[] = [];
    if (hasModule('DASHBOARD')) {
      main.push({ kind: 'link', key: 'overview', to: '/app', label: 'Visão Geral', icon: LayoutGrid });
    }
    if (showClientes) {
      main.push({ kind: 'link', key: 'clientes', to: '/app/clientes', label: 'Clientes', icon: HeartHandshake });
    }
    // Recursos Humanos — só Cargos/Funcionários desde 17/09/2026 (Ponto é um menu próprio).
    if (showCargos || showFuncionarios) {
      const children: NavLink[] = [];
      if (showFuncionarios) children.push({ kind: 'link', key: 'funcionarios', to: '/app/funcionarios', label: 'Funcionários' });
      if (showCargos) children.push({ kind: 'link', key: 'cargos', to: '/app/cargos', label: 'Cargos' });
      main.push({ kind: 'group', key: 'rh', label: 'Recursos Humanos', icon: Users, children });
    }
    // Ponto (17/09/2026): "Controle de Ponto" (bater o próprio) e "Administração de Ponto" (aprovar
    // ajustes/justificativas, escalas, feriados) são módulos INDEPENDENTES.
    if (hasModule('PONTO_REGISTRO') || hasModule('PONTO_ADMINISTRACAO')) {
      if (lockOf('PONTO_REGISTRO') && lockOf('PONTO_ADMINISTRACAO')) {
        main.push({
          kind: 'locked', key: 'ponto', label: 'Ponto', icon: Clock3,
          planLabel: lockOf('PONTO_REGISTRO')!.label, onClick: () => openUpgrade('Ponto', 'PONTO_REGISTRO'),
        });
      } else {
        const children: NavLink[] = [];
        if (hasModule('PONTO_REGISTRO')) children.push({ kind: 'link', key: 'ponto-registro', to: '/app/ponto', label: 'Controle de Ponto' });
        if (showPontoAdmin) {
          children.push({
            kind: 'link', key: 'ponto-admin', to: '/app/ponto-administracao', label: 'Administração de Ponto',
            badge: pontoPending ? { count: pontoPending, label: pontoPending === 1 ? '1 pendência de ponto aguardando análise' : `${pontoPending} pendências de ponto aguardando análise` } : null,
          });
        }
        main.push({ kind: 'group', key: 'ponto', label: 'Ponto', icon: Clock3, children });
      }
    }
    if (hasModule('COMERCIAL')) {
      main.push(lockOf('COMERCIAL')
        ? { kind: 'locked', key: 'comercial', label: 'Comercial', icon: BriefcaseBusiness, planLabel: lockOf('COMERCIAL')!.label, onClick: () => openUpgrade('Comercial', 'COMERCIAL') }
        : {
          kind: 'group', key: 'comercial', label: 'Comercial', icon: BriefcaseBusiness,
          children: [{ kind: 'link', key: 'orcamentos', to: '/app/orcamentos', label: 'Orçamentos' }],
        } satisfies NavGroup);
    }
    if (hasModule('OPERACOES')) {
      main.push(lockOf('OPERACOES')
        ? { kind: 'locked', key: 'operacoes', label: 'Operações', icon: Package, planLabel: lockOf('OPERACOES')!.label, onClick: () => openUpgrade('Operações', 'OPERACOES') }
        : {
          kind: 'group', key: 'operacoes', label: 'Operações', icon: Package,
          children: [
            { kind: 'link', key: 'estoque', to: '/app/estoque', label: 'Estoque' },
            { kind: 'link', key: 'compras', to: '/app/compras', label: 'Compras / Cotações' },
            // Antes era um <a href="#"> que não levava a lugar nenhum.
            { kind: 'disabled', key: 'logistica', label: 'Logística', note: 'Em breve' },
          ],
        } satisfies NavGroup);
    }
    if (hasModule('FINANCAS')) {
      main.push(lockOf('FINANCAS')
        ? { kind: 'locked', key: 'financas', label: 'Finanças', icon: Wallet, planLabel: lockOf('FINANCAS')!.label, onClick: () => openUpgrade('Finanças', 'FINANCAS') }
        : { kind: 'link', key: 'financas', to: '/app/financas', label: 'Finanças', icon: Wallet });
    }
    if (hasModule('DASHBOARD')) {
      main.push(lockOf('ANALYTICS')
        ? { kind: 'locked', key: 'analytics', label: 'Analytics e Dashboards', icon: LineChart, planLabel: lockOf('ANALYTICS')!.label, onClick: () => openUpgrade('Analytics e Dashboards', 'ANALYTICS') }
        : { kind: 'link', key: 'analytics', to: '/app/analytics', label: 'Analytics e Dashboards', icon: LineChart });
    }

    // Administração — gateada pelas permissões do perfil (27/09/2026), não por `role === 'admin'`:
    // Usuários e Perfis com `usuarios.gerenciar`, Campos Personalizados com
    // `campos-personalizados.gerenciar` (as mesmas que o backend exige).
    const admin: NavEntry[] = [];
    if (canManageUsers) {
      admin.push({ kind: 'link', key: 'usuarios', to: '/app/usuarios', label: 'Usuários e Acessos', icon: ShieldCheck });
      admin.push({ kind: 'link', key: 'perfis', to: '/app/perfis', label: 'Perfis de Acesso', icon: KeyRound });
    }
    if (canManageCustomFields) {
      admin.push({ kind: 'link', key: 'campos', to: '/app/campos-personalizados', label: 'Campos Personalizados', icon: SlidersHorizontal });
    }
    return [{ key: 'main', entries: main }, { key: 'admin', entries: admin }];
    // Recalcula quando o login (módulos/permissões/plano) ou a contagem de pendências mudam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, pontoPending]);

  const sidebarProps = { sections, isActive, openGroups, onToggleGroup: toggleGroup, brand: BRAND };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar (desktop) */}
      <aside className="w-[272px] shrink-0 border-r border-border bg-sidebar hidden md:block h-screen sticky top-0">
        <AppSidebar {...sidebarProps} layoutId="sidebar-desktop" />
      </aside>

      {/* Sidebar (celular): gaveta lateral com o mesmo componente */}
      <AnimatePresence>
        {isMobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Menu">
            <motion.button
              type="button"
              aria-label="Fechar menu"
              className="absolute inset-0 bg-black/30"
              onClick={closeMobileNav}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />
            <motion.aside
              className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-sidebar border-r border-border shadow-xl"
              initial={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
              animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { x: '-100%' }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <button
                type="button"
                onClick={closeMobileNav}
                className="absolute right-3 top-3 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-secondary"
                aria-label="Fechar menu"
              >
                <X size={18} strokeWidth={1.6} />
              </button>
              <AppSidebar {...sidebarProps} layoutId="sidebar-mobile" />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Conteúdo */}
      <main className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        <header className="h-14 shrink-0 border-b border-border bg-panel flex items-center justify-between px-4 md:px-6 z-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              className="md:hidden h-9 w-9 inline-flex items-center justify-center rounded-lg border border-border text-foreground hover:bg-secondary"
              aria-label="Abrir menu"
            >
              <Menu size={18} strokeWidth={1.6} />
            </button>
            <span className="md:hidden" aria-label={BRAND}><SteeraLogo variant="mono" centerClassName="fill-background" size="text-[24px]" /></span>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
            <UserProfileDropdown onOpenProfile={() => setIsProfileOpen(true)} />
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <motion.div
            key={location.pathname}
            // h-full: várias telas (ex.: Clientes) montam a altura a partir do container de rolagem;
            // sem isso o invólucro da animação colapsa e corta o conteúdo.
            className="h-full"
            initial={reduceMotion ? false : { opacity: 0, y: 6, filter: 'blur(4px)' }}
            // `filter` só durante a entrada: mesmo `blur(0px)` cria um novo bloco de contenção e
            // quebraria todo `position: fixed` (modais/gavetas) renderizado dentro das páginas — por
            // isso termina em `none` (o `y: 0` o framer já devolve como `transform: none`).
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {lockedRoute ? (
              <PlanUpgradeNotice
                featureLabel={PLAN_ITEM_LABELS[lockedRouteItem as string] ?? (lockedRouteItem as string)}
                planLabel={lockedRoute.label}
                onShowPlans={() =>
                  openUpgrade(PLAN_ITEM_LABELS[lockedRouteItem as string] ?? (lockedRouteItem as string), lockedRouteItem as string)
                }
              />
            ) : (
              <Outlet />
            )}
          </motion.div>
        </div>
      </main>

      {isProfileOpen && <UserProfileDrawer onClose={() => setIsProfileOpen(false)} />}
      <PlanUpgradeModal target={upgradeTarget} onClose={closeUpgrade} />
    </div>
  );
};

export default AppLayout;
