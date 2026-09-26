import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import AuthCard from '../components/AuthCard';
import { getCurrentUser, refreshCurrentUser, resendVerification, verifyEmail } from '../lib/auth';

type Status = 'loading' | 'success' | 'error';
type ResendState = 'idle' | 'sending' | 'sent' | 'error';

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<Status>('loading');
  const [loggedIn, setLoggedIn] = useState(!!getCurrentUser());
  const [resendState, setResendState] = useState<ResendState>('idle');
  // Guarda contra o StrictMode montando o componente duas vezes em dev (e contra o próprio efeito
  // rodando de novo por qualquer outro motivo) — o segundo POST /auth/verify-email pra um token já
  // consumido pelo primeiro daria 400, mostrando "link inválido" logo depois de um sucesso real.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setStatus('error');
      return;
    }

    (async () => {
      try {
        await verifyEmail(token);
        setStatus('success');
        if (getCurrentUser()) {
          try {
            await refreshCurrentUser();
            setLoggedIn(true);
          } catch {
            // Confirmação já aconteceu no backend — não crítico não conseguir atualizar o perfil em
            // memória agora (a próxima renovação de sessão traz o dado certo).
          }
        }
      } catch {
        // Um clique duplo no link (StrictMode ou o próprio usuário reabrindo o e-mail) manda um
        // segundo POST pra um token já consumido — o backend rejeita com 400 mesmo o e-mail já
        // tendo sido confirmado da primeira vez. Se a pessoa estiver logada, confere o estado real
        // via /auth/me antes de mostrar "link inválido": evita um falso negativo.
        if (getCurrentUser()) {
          try {
            const refreshed = await refreshCurrentUser();
            setLoggedIn(true);
            setStatus(refreshed.emailVerified ? 'success' : 'error');
            return;
          } catch {
            // segue pro estado de erro abaixo
          }
        }
        setStatus('error');
      }
    })();
  }, [token]);

  const handleResend = async () => {
    setResendState('sending');
    try {
      await resendVerification();
      setResendState('sent');
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
          <Link
            to={loggedIn ? '/app' : '/login'}
            className="inline-flex items-center justify-center w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20"
          >
            {loggedIn ? 'Entrar no sistema' : 'Entrar'}
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
