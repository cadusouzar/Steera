import React from 'react';
import { Link } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

const Navbar = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="absolute top-0 w-full z-50">
      <div className="container mx-auto px-6 py-6 flex items-center justify-between">
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
        
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleTheme}
            className="p-2 text-muted hover:text-foreground hover:bg-secondary/50 rounded-full transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          
          <Link to="/login" className="text-sm font-medium text-foreground hover:text-primary transition-colors hidden sm:block">
            Entrar
          </Link>
          
          <a href="#pricing" className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm">
            Assinar
          </a>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
