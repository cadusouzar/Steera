import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Shield, CreditCard, CheckCircle2, Loader2 } from 'lucide-react';
import { changePassword, getCurrentUser } from '../lib/auth';
import { listSystemUsers } from '../lib/api';
import FormField from './FormField';
import { inputBorderClass } from '../lib/validation';

interface UserProfileDrawerProps {
  onClose: () => void;
}

const PLAN_LABELS: Record<string, string> = {
  BASICO: 'Básico',
  PRO: 'Pro',
  EMPRESARIAL: 'Empresarial',
};

const UserProfileDrawer: React.FC<UserProfileDrawerProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'geral' | 'seguranca' | 'assinatura'>('geral');
  const currentUser = getCurrentUser();

  // Segurança — troca de senha real (PATCH /auth/me/password via changePassword() em lib/auth.ts).
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setConfirmError('');
    if (newPassword.length < 8) {
      setPasswordError('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setConfirmError('As senhas não coincidem.');
      return;
    }
    setIsSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Não foi possível trocar a senha');
    } finally {
      setIsSavingPassword(false);
    }
  };

  // Assinatura — uso real de logins de funcionário só é relevante (e só é buscado) para um
  // ADMIN: um EMPLOYEE não gerencia o plano da empresa. GET /companies/me/users não tem
  // @Roles('ADMIN') no backend, mas buscar isso pra todo mundo seria uma chamada sem propósito.
  const [activeEmployeeLogins, setActiveEmployeeLogins] = useState<number | null>(null);
  const [usageError, setUsageError] = useState(false);

  useEffect(() => {
    if (activeTab !== 'assinatura' || currentUser?.role !== 'admin' || activeEmployeeLogins !== null) return;
    listSystemUsers()
      .then((users) => {
        setActiveEmployeeLogins(users.filter((u) => u.role === 'employee' && u.status === 'active').length);
      })
      .catch(() => setUsageError(true));
  }, [activeTab, currentUser?.role, activeEmployeeLogins]);

  const email = currentUser?.email ?? '';
  // Nome do responsável quando existir (fundador, desde o cadastro ampliado); senão o e-mail, como antes.
  const displayName = currentUser?.name?.trim() || email;
  const avatarInitial = displayName.charAt(0).toUpperCase() || '?';
  const roleLabel = currentUser?.role === 'admin' ? 'Administrador' : 'Funcionário';
  const planLabel = currentUser?.planTier ? (PLAN_LABELS[currentUser.planTier] ?? currentUser.planTier) : '—';

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
                    <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-primary to-accent border-4 border-background shadow-xl flex items-center justify-center font-heading font-bold text-white text-3xl overflow-hidden shrink-0">
                      {avatarInitial}
                    </div>
                    <div className="flex-1 space-y-1 text-center sm:text-left">
                      <h3 className="text-xl font-bold text-foreground break-all">{displayName}</h3>
                      <span className="inline-block mt-2 px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded-lg uppercase tracking-wider">
                        {roleLabel}
                      </span>
                    </div>
                  </div>

                  <div className="bg-secondary/20 border border-border/60 rounded-2xl divide-y divide-border/50">
                    <div className="flex items-center justify-between px-5 py-4">
                      <span className="text-sm font-medium text-muted">E-mail</span>
                      <span className="text-sm font-bold text-foreground">{email}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-4">
                      <span className="text-sm font-medium text-muted">Papel</span>
                      <span className="text-sm font-bold text-foreground">{roleLabel}</span>
                    </div>
                    <div className="flex items-center justify-between px-5 py-4">
                      <span className="text-sm font-medium text-muted">Empresa</span>
                      <span className="text-sm font-bold text-foreground">{currentUser?.companyName ?? '—'}</span>
                    </div>
                    {currentUser?.legalName && (
                      <div className="flex items-center justify-between gap-4 px-5 py-4">
                        <span className="text-sm font-medium text-muted">{currentUser.personType === 'PF' ? 'Nome completo' : 'Razão social'}</span>
                        <span className="text-sm font-bold text-foreground text-right">{currentUser.legalName}</span>
                      </div>
                    )}
                    {currentUser?.tradeName && (
                      <div className="flex items-center justify-between gap-4 px-5 py-4">
                        <span className="text-sm font-medium text-muted">Nome fantasia</span>
                        <span className="text-sm font-bold text-foreground text-right">{currentUser.tradeName}</span>
                      </div>
                    )}
                    {currentUser?.documentMasked && (
                      <div className="flex items-center justify-between gap-4 px-5 py-4">
                        <span className="text-sm font-medium text-muted">{currentUser.personType === 'PF' ? 'CPF' : 'CNPJ'}</span>
                        <span className="text-sm font-bold text-foreground font-mono">{currentUser.documentMasked}</span>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted">
                    O e-mail é a identidade deste login e não pode ser alterado por aqui. Os dados
                    cadastrais da empresa ainda não podem ser editados pelo sistema. Dados de
                    funcionário (nome, CPF, telefone, etc.), quando aplicável, são gerenciados na
                    tela de Funcionários.
                  </p>
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
                    <form onSubmit={handleChangePassword} className="space-y-4">
                      {passwordError && (
                        <p className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
                          {passwordError}
                        </p>
                      )}
                      <FormField label="Senha Atual" htmlFor="current-password">
                        <input
                          id="current-password"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="••••••••"
                          autoComplete="current-password"
                          required
                          className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                        />
                      </FormField>
                      <FormField label="Nova Senha" htmlFor="new-password" hint="Mínimo de 8 caracteres.">
                        <input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                          autoComplete="new-password"
                          required
                          className="w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                        />
                      </FormField>
                      <FormField label="Confirmar Nova Senha" htmlFor="confirm-password" error={confirmError}>
                        <input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
                          autoComplete="new-password"
                          required
                          className={`w-full bg-background border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition-shadow ${inputBorderClass(!!confirmError)}`}
                        />
                      </FormField>
                      <div className="pt-2 flex items-center justify-end gap-3">
                        {passwordSaved && <span className="text-green-500 text-sm font-bold flex items-center gap-1"><CheckCircle2 size={16}/> Senha atualizada!</span>}
                        <button
                          type="submit"
                          disabled={isSavingPassword}
                          className="px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center gap-2"
                        >
                          {isSavingPassword && <Loader2 size={16} className="animate-spin" />}
                          Atualizar Senha
                        </button>
                      </div>
                    </form>
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

                    <h3 className="text-3xl font-heading font-bold text-foreground mb-2">QuickFlow {planLabel}</h3>
                    <p className="text-muted font-medium max-w-sm">
                      Cobrança e faturas ainda não estão disponíveis nesta versão do QuickFlow.
                    </p>
                  </div>

                  {currentUser?.role === 'admin' && (
                    <div className="bg-secondary/20 border border-border/60 p-6 rounded-2xl">
                      <h4 className="font-bold text-foreground mb-4">Uso do Plano</h4>

                      {usageError ? (
                        <p className="text-sm text-muted">Não foi possível carregar o uso do plano agora.</p>
                      ) : activeEmployeeLogins === null ? (
                        <p className="text-sm text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando...</p>
                      ) : (
                        <div>
                          <div className="flex justify-between text-sm font-medium mb-1.5">
                            <span className="text-muted">Logins de Funcionário Ativos</span>
                            <span className="text-foreground">
                              {activeEmployeeLogins} / {currentUser.maxEmployeeLogins ?? '—'}
                            </span>
                          </div>
                          <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border/50">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{
                                width: currentUser.maxEmployeeLogins
                                  ? `${Math.min(100, (activeEmployeeLogins / currentUser.maxEmployeeLogins) * 100)}%`
                                  : '0%',
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
