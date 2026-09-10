import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Shield, CreditCard, Camera, CheckCircle2 } from 'lucide-react';

interface UserProfileDrawerProps {
  onClose: () => void;
}

const UserProfileDrawer: React.FC<UserProfileDrawerProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'geral' | 'seguranca' | 'assinatura'>('geral');
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

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
                  className="space-y-8"
                >
                  {/* Avatar section */}
                  <div className="flex flex-col items-center sm:flex-row sm:items-start gap-6">
                    <div className="relative group">
                      <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-primary to-accent border-4 border-background shadow-xl flex items-center justify-center font-heading font-bold text-white text-3xl overflow-hidden">
                        C
                      </div>
                      <button className="absolute inset-0 bg-black/50 text-white rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera size={24} />
                        <span className="text-[10px] font-bold mt-1 uppercase tracking-wider">Alterar</span>
                      </button>
                    </div>
                    <div className="flex-1 space-y-1 text-center sm:text-left">
                      <h3 className="text-xl font-bold text-foreground">Carlos Eduardo</h3>
                      <p className="text-muted text-sm font-medium">carlos@exemplo.com</p>
                      <span className="inline-block mt-2 px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded-lg uppercase tracking-wider">
                        Administrador
                      </span>
                    </div>
                  </div>

                  <form onSubmit={handleSave} className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">Nome Completo</label>
                        <input type="text" defaultValue="Carlos Eduardo" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">E-mail</label>
                        <input type="email" defaultValue="carlos@exemplo.com" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                      </div>
                      
                      <div className="sm:col-span-2 mt-2">
                        <h4 className="font-heading font-bold text-foreground border-b border-border/50 pb-2">Documentação</h4>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">CPF</label>
                        <input type="text" placeholder="000.000.000-00" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">Passaporte / ID Estrangeiro</label>
                        <input type="text" placeholder="Opcional" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                      </div>
                      
                      <div className="sm:col-span-2 mt-2">
                        <h4 className="font-heading font-bold text-foreground border-b border-border/50 pb-2">Informações Profissionais</h4>
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">Telefone</label>
                        <input type="tel" placeholder="(00) 00000-0000" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">Setor</label>
                        <input type="text" defaultValue="Diretoria" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow" />
                      </div>
                    </div>
                    
                    <div className="pt-4 flex items-center justify-end gap-3 border-t border-border/40">
                      {saved && <span className="text-green-500 text-sm font-bold flex items-center gap-1 mr-2"><CheckCircle2 size={16}/> Salvo!</span>}
                      <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold border border-border text-foreground hover:bg-secondary transition-colors">Cancelar</button>
                      <button type="submit" className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20">Salvar Alterações</button>
                    </div>
                  </form>
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
                  <div className="bg-secondary/20 border border-border/60 p-6 rounded-2xl">
                    <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2"><Shield size={20} className="text-primary"/> Alterar Senha</h3>
                    <form onSubmit={handleSave} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">Senha Atual</label>
                        <input type="password" placeholder="••••••••" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">Nova Senha</label>
                        <input type="password" placeholder="••••••••" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">Confirmar Nova Senha</label>
                        <input type="password" placeholder="••••••••" className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                      </div>
                      <div className="pt-2 flex justify-end">
                        <button type="submit" className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20">Atualizar Senha</button>
                      </div>
                    </form>
                  </div>

                  <div className="bg-secondary/20 border border-border/60 p-6 rounded-2xl flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-foreground">Autenticação em Dois Fatores (2FA)</h4>
                      <p className="text-sm text-muted mt-1">Aumente a segurança da sua conta exigindo um código extra no login.</p>
                    </div>
                    <button className="px-4 py-2 bg-background border border-border hover:border-primary text-foreground font-bold text-sm rounded-xl transition-colors">
                      Ativar
                    </button>
                  </div>
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
                  <div className="bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 p-6 md:p-8 rounded-3xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                      <CreditCard size={120} />
                    </div>
                    
                    <span className="inline-block px-3 py-1 bg-primary/20 text-primary text-xs font-bold rounded-full uppercase tracking-wider mb-4 border border-primary/30">
                      Plano Atual
                    </span>
                    
                    <h3 className="text-3xl font-heading font-bold text-foreground mb-2">QuickFlow Pro</h3>
                    <p className="text-muted font-medium max-w-sm mb-6">Você está no plano mais completo. Todos os módulos e recursos estão liberados.</p>
                    
                    <div className="bg-background/80 backdrop-blur border border-border/50 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted">Próxima Fatura</p>
                        <p className="text-xl font-bold text-foreground mt-1">R$ 299,90 <span className="text-sm font-normal text-muted">/ mês</span></p>
                        <p className="text-sm font-medium text-foreground/70 mt-1">Vence em 15 de Agosto</p>
                      </div>
                      <div className="flex gap-2">
                        <button className="px-4 py-2 bg-background border border-border hover:bg-secondary text-foreground text-sm font-bold rounded-xl transition-colors">Ver Faturas</button>
                        <button className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-bold rounded-xl transition-colors shadow-md shadow-primary/20">Gerenciar Plano</button>
                      </div>
                    </div>
                  </div>

                  <div className="bg-secondary/20 border border-border/60 p-6 rounded-2xl">
                    <h4 className="font-bold text-foreground mb-4">Uso do Sistema</h4>
                    
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-sm font-medium mb-1.5">
                          <span className="text-muted">Usuários Cadastrados</span>
                          <span className="text-foreground">12 / 20</span>
                        </div>
                        <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border/50">
                          <div className="h-full bg-primary rounded-full w-[60%]"></div>
                        </div>
                      </div>
                      
                      <div>
                        <div className="flex justify-between text-sm font-medium mb-1.5">
                          <span className="text-muted">Armazenamento</span>
                          <span className="text-foreground">15 GB / 50 GB</span>
                        </div>
                        <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border/50">
                          <div className="h-full bg-accent rounded-full w-[30%]"></div>
                        </div>
                      </div>
                    </div>
                  </div>
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
