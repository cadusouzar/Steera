import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Settings, LogOut, ChevronDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../lib/auth';

interface UserProfileDropdownProps {
  onOpenProfile: () => void;
}

const UserProfileDropdown: React.FC<UserProfileDropdownProps> = ({ onOpenProfile }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
        className="flex items-center gap-2 p-1 pr-2 rounded-full hover:bg-secondary/50 transition-colors border border-transparent hover:border-border/50"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-accent border-2 border-background flex items-center justify-center text-white font-heading font-bold text-sm shadow-sm">
          C
        </div>
        <ChevronDown size={14} className={`text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute right-0 mt-2 w-64 bg-background border border-border rounded-2xl shadow-xl overflow-hidden z-[100]"
          >
            <div className="p-4 border-b border-border/50 bg-secondary/10">
              <p className="font-bold text-foreground text-sm">Carlos Eduardo</p>
              <p className="text-xs text-muted font-medium mt-0.5 truncate">carlos@exemplo.com</p>
            </div>
            
            <div className="p-2 space-y-1">
              <button 
                onClick={() => {
                  setIsOpen(false);
                  onOpenProfile();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-secondary/50 transition-colors text-left"
              >
                <User size={16} className="text-primary/70" />
                Meu Perfil
              </button>
              
              <Link 
                to="/app" 
                onClick={() => setIsOpen(false)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-foreground/80 hover:text-foreground hover:bg-secondary/50 transition-colors text-left"
              >
                <Settings size={16} className="text-accent/70" />
                Configurações da Conta
              </Link>
            </div>
            
            <div className="p-2 border-t border-border/50">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-500/10 transition-colors text-left"
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
