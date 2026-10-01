import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, logout } from '../lib/auth';

interface UserProfileDropdownProps {
  onOpenProfile: () => void;
}

const UserProfileDropdown: React.FC<UserProfileDropdownProps> = ({ onOpenProfile }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const email = currentUser?.email ?? '';
  // Nome do responsável quando existir (fundador, desde o cadastro ampliado); senão o e-mail, como antes.
  const displayName = currentUser?.name?.trim() || email;
  const avatarInitial = displayName.charAt(0).toUpperCase() || '?';
  const roleLabel = currentUser?.role === 'admin' ? 'Administrador' : 'Funcionário';

  // Chama o logout real (POST /auth/logout, limpa a sessão em memória) e só
  // então navega pra /login — RequireAuth (Task 9) já garante que voltar
  // pro /app depois disso (inclusive via botão "voltar" do navegador) falha
  // a checagem de autenticação e redireciona de novo pro login.
  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1 pr-2 rounded-lg hover:bg-secondary transition-colors"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Menu da conta"
      >
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold text-sm">
          {avatarInitial}
        </div>
        <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 mt-2 w-64 bg-panel border border-border rounded-lg shadow-lg overflow-hidden z-[100]"
          >
            <div className="p-4 border-b border-border">
              <p className="font-semibold text-foreground text-sm truncate">{displayName}</p>
              {currentUser?.name && <p className="text-xs text-muted truncate">{email}</p>}
              <p className="text-xs text-muted font-medium mt-0.5 truncate">
                {roleLabel}
                {currentUser?.companyName ? ` · ${currentUser.companyName}` : ''}
              </p>
            </div>

            <div className="p-2 space-y-1">
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenProfile();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-secondary/50 transition-colors text-left"
              >
                <User size={16} strokeWidth={1.6} className="text-muted" />
                Meu Perfil
              </button>
            </div>
            
            <div className="p-2 border-t border-border">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-danger hover:bg-danger/10 transition-colors text-left"
              >
                <LogOut size={16} />
                Sair
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UserProfileDropdown;
