import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import ThemeToggle from './ThemeToggle';
import { getCurrentUser, restoreSession } from '../lib/auth';

const Navbar = () => {
  const { theme, toggleTheme } = useTheme();

  // Sessão só em memória (access token nunca vai pra storage): se não houver usuário carregado,
  // tenta o mesmo restoreSession() do RequireAuth (refresh via cookie HttpOnly, com a deduplicação
  // de chamadas concorrentes que já existe em auth.ts). Visitante anônimo recebe 401 e continua
  // vendo "Entrar" — custo aceito: conta no limite de 60/15min por IP de /auth/refresh.
  const [isLoggedIn, setIsLoggedIn] = useState(() => getCurrentUser() !== null);

  useEffect(() => {
    if (isLoggedIn) return;
    let cancelled = false;
    restoreSession()
      .then((user) => { if (!cancelled && user) setIsLoggedIn(true); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  return (
    <nav className="absolute top-0 w-full z-50">
      <div className="container mx-auto px-4 sm:px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center font-heading font-bold text-white shadow-lg shadow-primary/20">
            Q
          </div>
          <span className="font-heading font-bold text-xl tracking-tight text-foreground">QuickFlow</span>
        </div>
        
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted">
          <a href="#features" className="hover:text-foreground transition-colors">Recursos</a>
          <a href="#modules" className="hover:text-foreground transition-colors">Módulos</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Planos</a>
        </div>
        
        {/* gap/padding menores abaixo de `sm`: em 360px, toggle de tema + "Entrar no sistema" +
            "Assinar" estouravam a largura (rolagem horizontal). No celular o link logado vira só o
            ícone, com aria-label pro leitor de tela. */}
        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

          {isLoggedIn ? (
            <Link
              to="/app"
              aria-label="Entrar no sistema"
              title="Entrar no sistema"
              className="inline-flex items-center gap-2 -m-1 p-1 sm:m-0 sm:p-0 text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              <LogIn size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Entrar no sistema</span>
            </Link>
          ) : (
            <Link to="/login" className="text-sm font-medium text-foreground hover:text-primary transition-colors hidden sm:block">
              Entrar
            </Link>
          )}
          
          <a href="#pricing" className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm">
            Assinar
          </a>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
