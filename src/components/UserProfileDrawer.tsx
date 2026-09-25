import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Shield, CreditCard } from 'lucide-react';
import AccountProfileDetails from './account/AccountProfileDetails';
import AccountSubscriptionDetails from './account/AccountSubscriptionDetails';
import AccountPasswordForm from './account/AccountPasswordForm';
import { getCurrentUser } from '../lib/auth';

interface UserProfileDrawerProps {
  onClose: () => void;
}

const UserProfileDrawer: React.FC<UserProfileDrawerProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'geral' | 'seguranca' | 'assinatura'>('geral');
  const currentUser = getCurrentUser();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
        className="fixed inset-0 z-[120] bg-background/80 backdrop-blur-sm flex justify-end"
      >
        <motion.div
          initial={{ x: '100%', opacity: 0.5 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0.5 }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          className="bg-background border-l border-border/60 w-full max-w-xl h-full flex flex-col shadow-2xl relative"
        >
          {/* Header */}
          <div className="p-6 md:p-8 border-b border-border/40 shrink-0 bg-secondary/10">
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-2xl font-heading font-bold text-foreground">Perfil de Usuário</h2>
              <button onClick={onClose} className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-2">
              <button
                onClick={() => setActiveTab('geral')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'geral' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-foreground hover:bg-secondary/50'}`}
              >
                <User size={16} /> Geral
              </button>
              <button
                onClick={() => setActiveTab('seguranca')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'seguranca' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-foreground hover:bg-secondary/50'}`}
              >
                <Shield size={16} /> Segurança
              </button>
              <button
                onClick={() => setActiveTab('assinatura')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'assinatura' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-foreground hover:bg-secondary/50'}`}
              >
                <CreditCard size={16} /> Assinatura
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8">
            <AnimatePresence mode="wait">
              {activeTab === 'geral' && (
                <motion.div
                  key="geral"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <AccountProfileDetails user={currentUser} />
                </motion.div>
              )}

              {activeTab === 'seguranca' && (
                <motion.div
                  key="seguranca"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <AccountPasswordForm />
                </motion.div>
              )}

              {activeTab === 'assinatura' && (
                <motion.div
                  key="assinatura"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <AccountSubscriptionDetails user={currentUser} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default UserProfileDrawer;
