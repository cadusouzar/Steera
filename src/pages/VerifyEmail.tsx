import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import AuthCard from '../components/AuthCard';
import { useUrlToken } from '../hooks/useUrlToken';
import {
  getCurrentUser,
  refreshCurrentUser,
  resendVerification,
  RESEND_VERIFICATION_COOLDOWN_MESSAGE,
  restoreSession,
  subscribeCurrentUser,
  verifyEmail,
  type CurrentUser,
} from '../lib/auth';

type Status = 'loading' | 'success' | 'error';
type ResendState = 'idle' | 'sending' | 'sent' | 'cooldown' | 'error';

// Garante o usuário da sessão antes de decidir o que mostrar (fix final de "Acesso e sessões"): o
// link costuma ser aberto numa aba nova, onde o access token em memória ainda não existe — sem
// restaurar a sessão (cookie HttpOnly) primeiro, um visitante logado via "Entrar" em vez de "Entrar
// no sistema" e nunca via o "Reenviar e-mail". Com sessão já em memória, só relê o perfil (o
// emailVerified mudou agora). Nunca lança: sem sessão (ou servidor indisponível) → null.
async function loadSessionUser(): Promise<CurrentUser | null> {
  if (getCurrentUser()) {
    try {
      return await refreshCurrentUser();
    } catch {
      return getCurrentUser();
    }
  }
  return restoreSession();
}

const VerifyEmail = () => {
  const token = useUrlToken();
  const [status, setStatus] = useState<Status>('loading');
  // Segue o usuário atual (login/logout/restauração em qualquer outro componente, ex. a Navbar) —
  // nunca uma foto tirada na montagem.
  const [user, setUser] = useState<CurrentUser | null>(getCurrentUser());
  const loggedIn = !!user;
  const [resendState, setResendState] = useState<ResendState>('idle');
  // Guarda contra o StrictMode montando o componente duas vezes em dev (e contra o próprio efeito
  // rodando de novo por qualquer outro motivo) — o segundo POST /auth/verify-email pra um token já
  // consumido pelo primeiro daria 400, mostrando "link inválido" logo depois de um sucesso real.
  const attempted = useRef(false);

  useEffect(() => subscribeCurrentUser(setUser), []);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    (async () => {
      let verified = false;
      if (token) {
        try {
          await verifyEmail(token);
          verified = true;
        } catch {
          // Tratado abaixo, depois de saber se há sessão.
        }
      }
      // Sempre DEPOIS do POST (o perfil relido já vem com o e-mail confirmado) e ANTES de sair do
      // "loading" — a decisão entre os botões de logado/deslogado só acontece com a sessão resolvida.
      const sessionUser = await loadSessionUser();
      setUser(sessionUser);
      // Um clique duplo no link (StrictMode ou o próprio usuário reabrindo o e-mail) manda um segundo
      // POST pra um token já consumido — o backend rejeita com 400 mesmo o e-mail já tendo sido
      // confirmado da primeira vez. Logado, o estado real do perfil decide: evita um falso negativo.
      setStatus(verified || sessionUser?.emailVerified === true ? 'success' : 'error');
    })();
  }, [token]);

  const handleResend = async () => {
    setResendState('sending');
    try {
      setResendState((await resendVerification()) ? 'sent' : 'cooldown');
    } catch {
      setResendState('error');
    }
  };

  if (status === 'loading') {
    return (
      <AuthCard title="Confirmando e-mail" subtitle="Aguarde um instante.">
        <div className="flex justify-center py-4">
          <Loader2 size={28} className="animate-spin text-primary" aria-hidden="true" />
        </div>
      </AuthCard>
    );
  }

  if (status === 'success') {
    return (
      <AuthCard title="E-mail confirmado" subtitle="Sua conta está pronta para uso.">
        <div className="text-center">
          <CheckCircle2 size={40} className="mx-auto text-primary mb-6" aria-hidden="true" />
          {/* Sempre volta pra página inicial (pedido do usuário, 26/09/2026) — mesmo padrão do login:
              de lá a pessoa usa "Entrar no sistema" (logada) ou "Entrar" (deslogada) na barra. */}
          <Link
            to="/"
            className="inline-flex items-center justify-center w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20"
          >
            Voltar para a página inicial
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Link inválido" subtitle="Este link de confirmação é inválido ou expirou.">
      <div className="text-center space-y-4">
        <XCircle size={40} className="mx-auto text-red-500" aria-hidden="true" />
        {loggedIn ? (
          <div>
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === 'sending'}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {resendState === 'sending' ? 'Enviando...' : 'Reenviar e-mail'}
            </button>
            {resendState === 'sent' && (
              <p role="status" className="text-sm text-foreground/60 mt-3">
                E-mail reenviado. Confira sua caixa de entrada.
              </p>
            )}
            {resendState === 'cooldown' && (
              <p role="status" className="text-sm text-foreground/60 mt-3">
                {RESEND_VERIFICATION_COOLDOWN_MESSAGE}
              </p>
            )}
            {resendState === 'error' && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                Não foi possível reenviar agora. Tente novamente em instantes.
              </p>
            )}
          </div>
        ) : (
          <Link to="/login" className="text-primary hover:underline text-sm font-medium">
            Voltar para o login
          </Link>
        )}
      </div>
    </AuthCard>
  );
};

export default VerifyEmail;
