import React from 'react';
import { motion } from 'framer-motion';

interface ThemeToggleProps {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, toggleTheme }) => {
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className={`relative w-20 h-10 rounded-full overflow-hidden transition-colors duration-500 flex items-center px-1 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3),0_4px_6px_rgba(0,0,0,0.1)] border ${
        isDark ? 'bg-[#1e293b] border-slate-700' : 'bg-[#60a5fa] border-blue-300'
      }`}
      aria-label="Toggle Dark Mode"
    >
      {/* Background Stars (Dark Mode) */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${isDark ? 'opacity-100' : 'opacity-0'}`}>
        <svg className="absolute top-2 left-3 w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
        </svg>
        <svg className="absolute top-6 left-6 w-1.5 h-1.5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
        </svg>
        <svg className="absolute top-2 left-10 w-2 h-2 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
        </svg>
        <div className="absolute top-4 left-9 w-0.5 h-0.5 bg-white rounded-full"></div>
        <div className="absolute top-7 left-3 w-1 h-1 bg-white rounded-full"></div>
      </div>

      {/* Background Clouds (Light Mode) */}
      <div className={`absolute inset-0 transition-opacity duration-500 ${isDark ? 'opacity-0' : 'opacity-100'}`}>
        {/* Fill bottom edge completely */}
        <div className="absolute -bottom-2 -left-2 right-[-10px] h-4 bg-white z-0"></div>
        <div className="absolute -bottom-2 -right-1 w-8 h-8 bg-white rounded-full shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1)] z-10"></div>
        <div className="absolute bottom-1 right-3 w-8 h-8 bg-white rounded-full shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1)] z-10"></div>
        <div className="absolute -bottom-2 right-8 w-10 h-10 bg-white rounded-full shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1)] z-10"></div>
        <div className="absolute -bottom-3 right-4 w-12 h-6 bg-white rounded-full z-10"></div>
        <div className="absolute -bottom-2 right-12 w-6 h-6 bg-white rounded-full shadow-[inset_0_-2px_4px_rgba(0,0,0,0.1)] z-10"></div>
      </div>

      {/* Toggle Knob */}
      <motion.div
        className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center overflow-hidden shadow-[0_2px_5px_rgba(0,0,0,0.3)]"
        initial={false}
        animate={{
          x: isDark ? 40 : 0,
          backgroundColor: isDark ? '#e2e8f0' : '#fbbf24',
        }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      >
        {/* Craters for Moon */}
        <div className={`absolute inset-0 transition-opacity duration-500 ${isDark ? 'opacity-100' : 'opacity-0'}`}>
          <div className="absolute top-1.5 left-2 w-2 h-2 rounded-full bg-[#cbd5e1] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]"></div>
          <div className="absolute bottom-1.5 right-1.5 w-3 h-3 rounded-full bg-[#cbd5e1] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]"></div>
          <div className="absolute bottom-2 left-1.5 w-1.5 h-1.5 rounded-full bg-[#cbd5e1] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.2)]"></div>
        </div>
      </motion.div>
    </button>
  );
};

export default ThemeToggle;
