import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import ThemeToggle from './ThemeToggle';
import SiteAccountMenu from './SiteAccountMenu';
import { getCurrentUser, restoreSession, subscribeCurrentUser, type CurrentUser } from '../lib/auth';
import SteeraLogo, { SteeraMark } from './brand/SteeraLogo';
import { BRAND_NAME } from '../lib/brand';

const Navbar = () => {
  const { theme, toggleTheme } = useTheme();

  // Sessão só em memória (access token nunca vai pra storage): se não houver usuário carregado,
  // tenta o mesmo restoreSession() do RequireAuth (refresh via cookie HttpOnly, com a deduplicação
  // de chamadas concorrentes que já existe em auth.ts). Visitante anônimo recebe 401 e continua
  // vendo "Entrar / Criar conta" — custo aceito: conta no limite de 60/15min por IP de /auth/refresh.
  // Uma tentativa por montagem (ref): depois de "Sair" não tenta restaurar de novo à toa.
  // `mounted` separado (e não um `cancelled` por execução do efeito): no StrictMode de dev o efeito
  // roda, é limpo e roda de novo — com `cancelled`, a 1ª execução descartaria a resposta e a 2ª
  // nem tentaria (ref já marcada), deixando a barra "deslogada" com sessão válida.
  const [user, setUser] = useState<CurrentUser | null>(() => getCurrentUser());
  const restoreAttempted = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Reflete na hora mudanças feitas em outro lugar (nome editado em "Minha conta", sair).
  useEffect(() => subscribeCurrentUser(setUser), []);

  useEffect(() => {
    if (user || restoreAttempted.current) return;
    restoreAttempted.current = true;
    restoreSession()
      .then((restored) => { if (mounted.current && restored) setUser(restored); })
      .catch(() => undefined);
  }, [user]);

  const primaryButtonClass =
    'inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-3 sm:px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm whitespace-nowrap';

  return (
    <nav className="absolute top-0 w-full z-50">
      <div className="container mx-auto px-4 sm:px-6 py-6 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-foreground" aria-label={`${BRAND_NAME} — página inicial`}>
          {/* Abaixo de `sm` fica só o símbolo: com tema + conta + botão principal, 360px não comporta a
              palavra inteira sem rolagem horizontal. */}
          <SteeraMark className="h-10 w-10 sm:hidden" />
          <SteeraLogo className="hidden sm:inline-flex" size="text-[32px]" />
        </Link>

        {/* Links de seção como rota "/#secao" (não "#secao"): funcionam também fora da landing
            (ex.: /conta) — a LandingPage rola até a seção ao receber o hash. */}
        <div className="hidden lg:flex items-center gap-8 text-sm font-medium text-muted">
          <Link to={{ pathname: '/', hash: '#modulos' }} className="hover:text-foreground transition-colors">Módulos</Link>
          <Link to={{ pathname: '/', hash: '#personalizacao' }} className="hover:text-foreground transition-colors">Personalização</Link>
          <Link to={{ pathname: '/', hash: '#seguranca' }} className="hover:text-foreground transition-colors">Segurança</Link>
          <Link to={{ pathname: '/', hash: '#planos' }} className="hover:text-foreground transition-colors">Planos</Link>
          <Link to={{ pathname: '/', hash: '#duvidas' }} className="hover:text-foreground transition-colors">Dúvidas</Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

          {user ? (
            <>
              <SiteAccountMenu user={user} onLoggedOut={() => setUser(null)} />
              <Link to="/app" aria-label="Entrar no sistema" title="Entrar no sistema" className={primaryButtonClass}>
                <LogIn size={16} aria-hidden="true" />
                <span className="hidden sm:inline">Entrar no sistema</span>
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/login"
                aria-label="Entrar"
                className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <LogIn size={16} aria-hidden="true" className="sm:hidden" />
                <span className="hidden sm:inline">Entrar</span>
              </Link>
              <Link to="/register" className={primaryButtonClass}>
                Criar conta
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
