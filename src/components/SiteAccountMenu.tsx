import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, CreditCard, LogOut, User } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { logout, type CurrentUser } from '../lib/auth';
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

  const close = useCallback(() => setIsOpen(false), []);
  useEscapeKey(close);

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
        <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-accent border-2 border-background flex items-center justify-center text-white font-heading font-bold text-sm shadow-sm">
          {avatarInitial}
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

            <div className="p-2 space-y-1">
              <Link to="/conta" role="menuitem" onClick={close} className={itemClass}>
                <User size={16} className="text-muted" aria-hidden="true" /> Minha conta
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
