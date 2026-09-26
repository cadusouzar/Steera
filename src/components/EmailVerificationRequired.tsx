import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, MailCheck, RefreshCw } from 'lucide-react';
import FlowBackground from './FlowBackground';
import { ApiError } from '../lib/apiError';
import { logout, refreshCurrentUser, resendVerification, RESEND_VERIFICATION_COOLDOWN_MESSAGE } from '../lib/auth';

interface EmailVerificationRequiredProps {
  email: string;
}

type ResendState = 'idle' | 'sending' | 'sent' | 'cooldown' | 'error';

// Tela mínima (mesmo estilo de ForcedPasswordChange), mostrada por RequireAuth no lugar do app
// inteiro sob /app/* quando `currentUser.emailVerificationRequired && !currentUser.emailVerified`
// ("Acesso e sessões", 26/09/2026) — só o fundador que se registrou via POST /auth/register cai
// aqui; quem aceitou um convite já entra confirmado. Sem navegação pra fora daqui de propósito,
// mesmo espírito de ForcedPasswordChange — só confirmar ("Já confirmei") ou trocar de conta.
const EmailVerificationRequired: React.FC<EmailVerificationRequiredProps> = ({ email }) => {
  const navigate = useNavigate();
  const [resendState, setResendState] = useState<ResendState>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);

  const handleResend = async () => {
    setResendState('sending');
    setResendError(null);
    setCheckNotice(null);
    try {
      setResendState((await resendVerification()) ? 'sent' : 'cooldown');
    } catch (err) {
      setResendState('error');
      // ApiError já traz a mensagem amigável do backend (ex.: 429 "Muitas tentativas. Tente
      // novamente em N minutos." — FriendlyThrottlerGuard) — nunca reformatada aqui.
      setResendError(err instanceof ApiError ? err.message : 'Não foi possível reenviar o e-mail de confirmação.');
    }
  };

  // Chama refreshCurrentUser() (GET /auth/me) — se o e-mail já foi confirmado, o objeto atualizado
  // (via setCurrentUser/subscribeCurrentUser em auth.ts) faz RequireAuth reavaliar sozinho e trocar
  // esta tela pelo app, sem round-trip extra aqui. Se ainda não, só avisa e deixa a pessoa tentar de
  // novo.
  const handleAlreadyConfirmed = async () => {
    setIsChecking(true);
    setCheckNotice(null);
    try {
      const updated = await refreshCurrentUser();
      if (updated.emailVerificationRequired && !updated.emailVerified) {
        setCheckNotice('Ainda não encontramos a confirmação. Confira sua caixa de entrada (e o spam) e tente de novo em instantes.');
      }
    } catch {
      setCheckNotice('Não foi possível verificar agora. Tente novamente.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleSwitchAccount = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden flex items-center justify-center transition-colors duration-300">
      <FlowBackground />

      <div className="relative z-10 w-full max-w-md px-6 pointer-events-auto">
        <div className="glass-panel p-10 rounded-3xl text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mx-auto mb-6">
            <MailCheck size={28} aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-heading font-bold mb-2 text-foreground">Confirme seu e-mail para acessar o sistema</h1>
          <p className="text-foreground/60 text-sm mb-6">
            Enviamos um link para <span className="font-medium text-foreground break-all">{email}</span>. Abra o e-mail e
            clique em confirmar.
          </p>

          {resendState === 'sent' && (
            <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-3 mb-4 text-sm text-foreground">
              E-mail reenviado. Confira sua caixa de entrada (e o spam).
            </div>
          )}
          {resendState === 'cooldown' && (
            <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-3 mb-4 text-sm text-foreground">
              {RESEND_VERIFICATION_COOLDOWN_MESSAGE}
            </div>
          )}
          {resendState === 'error' && resendError && (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 mb-4 text-sm text-red-600 dark:text-red-400">
              {resendError}
            </div>
          )}
          {checkNotice && (
            <div role="status" className="rounded-xl border border-border bg-secondary/20 p-3 mb-4 text-sm text-muted">
              {checkNotice}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === 'sending'}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw size={16} className={resendState === 'sending' ? 'animate-spin' : ''} aria-hidden="true" />
              {resendState === 'sending' ? 'Enviando...' : 'Reenviar e-mail'}
            </button>

            <button
              type="button"
              onClick={handleAlreadyConfirmed}
              disabled={isChecking}
              className="w-full text-sm font-medium text-primary hover:underline disabled:opacity-60"
            >
              {isChecking ? 'Verificando...' : 'Já confirmei'}
            </button>

            <button
              type="button"
              onClick={handleSwitchAccount}
              className="w-full inline-flex items-center justify-center gap-2 text-sm font-medium text-muted hover:text-foreground transition-colors pt-3 mt-1 border-t border-border/50"
            >
              <LogOut size={14} aria-hidden="true" />
              Trocar de conta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailVerificationRequired;
