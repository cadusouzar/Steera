import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, CreditCard, LogOut, MailWarning, Shield, User } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/apiError';
import { logout, resendVerification, RESEND_VERIFICATION_COOLDOWN_MESSAGE, type CurrentUser } from '../lib/auth';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface SiteAccountMenuProps {
  user: CurrentUser;
  onLoggedOut: () => void;
}

// Menu da conta na barra do SITE (landing, /conta, /register) — não confundir com
// UserProfileDropdown, que é o menu de dentro do ERP (AppLayout).
const SiteAccountMenu: React.FC<SiteAccountMenuProps> = ({ user, onLoggedOut }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const displayName = user.name?.trim() || user.email;
  const avatarInitial = displayName.charAt(0).toUpperCase() || '?';
  // Só o fundador que se registrou via POST /auth/register cai aqui (quem aceitou um convite já
  // entra confirmado) — ver EmailVerificationRequired.tsx, que bloqueia o /app inteiro pro mesmo
  // caso; aqui é só um lembrete visível no site, sem bloquear nada.
  const emailPending = user.emailVerificationRequired && !user.emailVerified;
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'cooldown' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);

  const close = useCallback(() => setIsOpen(false), []);
  useEscapeKey(close);

  const handleResendVerification = async () => {
    setResendState('sending');
    setResendError(null);
    try {
      setResendState((await resendVerification()) ? 'sent' : 'cooldown');
    } catch (err) {
      setResendState('error');
      setResendError(err instanceof ApiError ? err.message : 'Não foi possível reenviar o e-mail de confirmação.');
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sai da conta e continua no site (não manda pro /login como o menu do ERP): a barra volta a
  // mostrar "Entrar / Criar conta". Se estava numa página que exige login (/conta), volta pra home.
  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    onLoggedOut();
    if (location.pathname.startsWith('/conta')) navigate('/', { replace: true });
  };

  const itemClass =
    'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/50 rounded-xl transition-colors';

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Menu da conta"
        className="flex items-center gap-1 p-1 rounded-full hover:bg-secondary/50 transition-colors border border-transparent hover:border-border/50"
      >
        <span className="relative">
          <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-accent border-2 border-background flex items-center justify-center text-white font-heading font-bold text-sm shadow-sm">
            {avatarInitial}
          </span>
          {emailPending && (
            <span
              aria-label="E-mail não confirmado"
              title="E-mail não confirmado"
              className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-500 border-2 border-background"
            />
          )}
        </span>
        <ChevronDown size={14} aria-hidden="true" className={`text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-background border border-border rounded-2xl shadow-xl overflow-hidden z-[100]"
          >
            <div className="p-4 border-b border-border/50 bg-secondary/10">
              <p className="font-bold text-foreground text-sm truncate">{displayName}</p>
              {user.name && <p className="text-xs text-muted truncate">{user.email}</p>}
              {user.companyName && <p className="text-xs text-muted font-medium mt-0.5 truncate">{user.companyName}</p>}
            </div>

            {emailPending && (
              <div className="p-2 border-b border-border/50">
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleResendVerification}
                  disabled={resendState === 'sending'}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-xl transition-colors disabled:opacity-60"
                >
                  <MailWarning size={16} aria-hidden="true" />
                  {resendState === 'sending' ? 'Enviando...' : 'Confirmar e-mail'}
                </button>
                {resendState === 'sent' && (
                  <p className="px-3 pt-1 text-xs text-muted">E-mail reenviado. Confira sua caixa de entrada.</p>
                )}
                {resendState === 'cooldown' && (
                  <p className="px-3 pt-1 text-xs text-muted">{RESEND_VERIFICATION_COOLDOWN_MESSAGE}</p>
                )}
                {resendState === 'error' && resendError && (
                  <p className="px-3 pt-1 text-xs text-red-600 dark:text-red-400">{resendError}</p>
                )}
              </div>
            )}

            <div className="p-2 space-y-1">
              <Link to="/conta" role="menuitem" onClick={close} className={itemClass}>
                <User size={16} className="text-muted" aria-hidden="true" /> Minha conta
              </Link>
              <Link to="/conta/seguranca" role="menuitem" onClick={close} className={itemClass}>
                <Shield size={16} className="text-muted" aria-hidden="true" /> Segurança
              </Link>
              <Link to="/conta/assinatura" role="menuitem" onClick={close} className={itemClass}>
                <CreditCard size={16} className="text-muted" aria-hidden="true" /> Assinatura
              </Link>
            </div>

            <div className="p-2 border-t border-border/50">
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
              >
                <LogOut size={16} aria-hidden="true" /> Sair
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SiteAccountMenu;
