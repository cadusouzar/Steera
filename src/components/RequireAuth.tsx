import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2, WifiOff } from 'lucide-react';
import { getCurrentUser, restoreSessionDetailed, subscribeCurrentUser, type CurrentUser } from '../lib/auth';
import ForcedPasswordChange from './ForcedPasswordChange';
import EmailVerificationRequired from './EmailVerificationRequired';

// Intervalos entre novas tentativas quando o servidor não pôde responder (o último se repete).
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

type AuthState = 'checking' | 'authenticated' | 'unauthenticated' | 'unavailable';

// Guarda de rota para /app/* e /conta*: no mount, se já não houver um
// usuário em memória (ex.: acabou de logar nesta mesma carga de página),
// tenta restaurar a sessão via cookie httpOnly (refresh + /auth/me).
// Enquanto a checagem não resolve, não renderiza `<Outlet />` de jeito
// nenhum — nem por um instante — pra nunca vazar conteúdo protegido antes
// de saber se o usuário está autenticado.
//
// Só manda pro login quando o servidor REJEITA a sessão (401/403). Se ele
// não pôde responder (backend reiniciando, sem rede, 429, 5xx), mostra
// "Reconectando…" e tenta de novo sozinho — antes disso, um F5 no momento
// errado deslogava a pessoa com a sessão ainda válida (bug de 25/09/2026).
const RequireAuth = () => {
  const location = useLocation();
  const [authState, setAuthState] = useState<AuthState>(() => (getCurrentUser() ? 'authenticated' : 'checking'));
  const [attempt, setAttempt] = useState(0);
  // Espelha o usuário atual em memória (auth.ts) — usado só pra decidir entre ForcedPasswordChange/
  // EmailVerificationRequired/Outlet abaixo. Assinar subscribeCurrentUser (em vez de copiar campos
  // específicos pra um estado próprio, como antes) significa que qualquer ação que atualize o
  // usuário global (changePassword(), o "Já confirmei" de EmailVerificationRequired via
  // refreshCurrentUser()) já reavalia esta tela sozinha, sem round-trip extra aqui.
  const [user, setUser] = useState<CurrentUser | null>(() => getCurrentUser());
  // Uma restauração de cada vez. Em dev, o React.StrictMode invoca o efeito
  // de mount duas vezes; duas chamadas concorrentes usariam o MESMO cookie de
  // refresh ainda não rotacionado, e o backend trata a reapresentação de um
  // token já rotacionado como replay (revoga a família inteira).
  const inFlight = useRef(false);

  useEffect(() => subscribeCurrentUser(setUser), []);

  const tryRestore = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    restoreSessionDetailed().then((result) => {
      inFlight.current = false;
      if (result.status === 'authenticated') {
        setAuthState('authenticated');
      } else if (result.status === 'unauthenticated') {
        setAuthState('unauthenticated');
      } else {
        setAuthState('unavailable');
        setAttempt((a) => a + 1);
      }
    });
  }, []);

  useEffect(() => {
    if (getCurrentUser()) {
      setAuthState('authenticated');
      return;
    }
    tryRestore();
  }, [tryRestore]);

  useEffect(() => {
    if (authState !== 'unavailable') return;
    const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
    const timer = setTimeout(tryRestore, delay);
    return () => clearTimeout(timer);
  }, [authState, attempt, tryRestore]);

  if (authState === 'checking') return null;
  if (authState === 'unauthenticated') {
    // Guarda pra onde a pessoa ia (ex.: /conta) — o Login devolve pra lá depois de entrar.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (authState === 'unavailable') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div role="status" aria-live="polite" className="w-full max-w-sm bg-panel border border-border rounded-3xl p-8 text-center shadow-lg">
          <WifiOff size={32} className="mx-auto text-muted mb-4" aria-hidden="true" />
          <h1 className="text-lg font-heading font-bold text-foreground">Reconectando ao servidor…</h1>
          <p className="text-sm text-muted mt-2">
            Não conseguimos falar com o servidor agora. Sua sessão continua ativa — estamos tentando de novo
            automaticamente.
          </p>
          <button
            type="button"
            onClick={tryRestore}
            className="mt-6 inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm"
          >
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            Tentar agora
          </button>
        </div>
      </div>
    );
  }
  if (user?.mustChangePassword) {
    // changePassword() já atualiza o usuário global (setCurrentUser) ao ter sucesso — a assinatura
    // acima reavalia esta tela sozinha; onDone só existe pra satisfazer a prop obrigatória.
    return <ForcedPasswordChange onDone={() => undefined} />;
  }
  // Bloqueio de e-mail não confirmado ("Acesso e sessões", 26/09/2026) — só pra rotas do ERP
  // (/app/*); /conta* continua liberado (é de lá que a pessoa também consegue reenviar/confirmar,
  // ver Account.tsx). Prioridade: troca de senha forçada primeiro (checada acima).
  if (user?.emailVerificationRequired && !user.emailVerified && location.pathname.startsWith('/app')) {
    return <EmailVerificationRequired email={user.email} />;
  }
  return <Outlet />;
};

export default RequireAuth;
