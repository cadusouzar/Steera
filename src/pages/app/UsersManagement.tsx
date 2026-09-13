import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Search, X, UserPlus, FileQuestion, LayoutDashboard, HeartHandshake, Users,
  TrendingUp, Package, BarChart3, Loader2, KeyRound, Copy, Check, ShieldOff, ShieldCheck,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import CustomSelect from '../../components/CustomSelect';
import { getCurrentUser } from '../../lib/auth';
import * as api from '../../lib/api';
import type { SystemUser, EmployeeListItem } from '../../lib/api';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrador' },
  { value: 'employee', label: 'Funcionário' },
];

// Ids em maiúsculo pra bater 1:1 com o enum `AppModule` do backend
// (backend/prisma/schema.prisma) — módulos valem igualmente pra login
// ADMIN e EMPLOYEE, então o mesmo conjunto de checkboxes aparece nos dois casos.
const AVAILABLE_MODULES = [
  { id: 'DASHBOARD', label: 'Visão Geral', icon: <LayoutDashboard size={16}/> },
  { id: 'CLIENTES', label: 'Clientes', icon: <HeartHandshake size={16}/> },
  { id: 'RH', label: 'Recursos Humanos', icon: <Users size={16}/> },
  { id: 'COMERCIAL', label: 'Comercial', icon: <TrendingUp size={16}/> },
  { id: 'OPERACOES', label: 'Operações', icon: <Package size={16}/> },
  { id: 'FINANCAS', label: 'Finanças', icon: <BarChart3 size={16}/> },
];

const moduleLabel = (id: string) => AVAILABLE_MODULES.find(m => m.id === id)?.label ?? id;

interface UserFormState {
  email: string;
  role: 'admin' | 'employee';
  employeeId: string;
  modules: string[];
}

const emptyForm: UserFormState = { email: '', role: 'admin', employeeId: '', modules: ['DASHBOARD'] };

const UsersManagement = () => {
  const isAdmin = getCurrentUser()?.role === 'admin';

  const [users, setUsers] = useState<SystemUser[]>([]);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<UserFormState>(emptyForm);

  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // Senha temporária devolvida pela criação — só existe nessa única resposta,
  // nunca mais recuperável depois. Fica num banner que só some com ação
  // explícita do admin (nunca no backdrop/Escape), pra garantir que ele
  // realmente copiou/anotou antes de perder o valor.
  const [createdCredential, setCreatedCredential] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [systemUsers, employeeItems] = await Promise.all([api.listSystemUsers(), api.listEmployees()]);
      setUsers(systemUsers);
      setEmployees(employeeItems);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os usuários.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEscapeKey(() => {
    if (isModalOpen) setIsModalOpen(false);
  });

  useEffect(() => {
    if (isModalOpen || createdCredential) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, createdCredential]);

  const employeeById = useMemo(() => {
    const map = new Map<string, EmployeeListItem>();
    employees.forEach(e => map.set(e.id, e));
    return map;
  }, [employees]);

  // Funcionários que ainda não têm login vinculado — cruza a lista de
  // funcionários com os employeeId já presentes em `users`. Filtro
  // proativo de UX: o backend já rejeita com 400 criar um segundo login
  // pro mesmo funcionário, isso só evita a pessoa escolher e bater no erro.
  const linkedEmployeeIds = useMemo(
    () => new Set(users.filter(u => u.employeeId).map(u => u.employeeId as string)),
    [users],
  );
  const availableEmployees = useMemo(
    () => employees.filter(e => !linkedEmployeeIds.has(e.id)),
    [employees, linkedEmployeeIds],
  );

  const filteredUsers = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase().trim();
    if (!lowerQuery) return users;
    return users.filter(u => {
      const employeeName = u.employeeId ? employeeById.get(u.employeeId)?.fullName ?? '' : '';
      const roleLabel = u.role === 'admin' ? 'administrador' : 'funcionário';
      return (
        u.email.toLowerCase().includes(lowerQuery) ||
        employeeName.toLowerCase().includes(lowerQuery) ||
        roleLabel.includes(lowerQuery)
      );
    });
  }, [users, searchQuery, employeeById]);

  const toggleModule = (moduleId: string) => {
    setFormData(prev => {
      const isSelected = prev.modules.includes(moduleId);
      if (isSelected) {
        return { ...prev, modules: prev.modules.filter(m => m !== moduleId) };
      }
      return { ...prev, modules: [...prev.modules, moduleId] };
    });
  };

  const openNewModal = () => {
    setFormData(emptyForm);
    setActionError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setActionError(null);
  };

  const isFormValid =
    formData.email.trim() !== '' &&
    (formData.role === 'admin' || formData.employeeId !== '');

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || !isFormValid) return;
    setIsSaving(true);
    setActionError(null);
    try {
      // Sempre chama o endpoint real e deixa o backend ser a autoridade —
      // o limite de logins do plano e a checagem de funcionário já vinculado
      // são validados lá (com dados em tempo real, sem depender de uma
      // contagem cacheada no cliente que outro admin pode ter invalidado).
      const result = await api.createSystemUser({
        email: formData.email.trim(),
        role: formData.role,
        employeeId: formData.role === 'employee' ? formData.employeeId : undefined,
        modules: formData.modules,
      });
      setUsers(prev => [...prev, result.user]);
      setCreatedCredential({ email: result.user.email, temporaryPassword: result.temporaryPassword });
      setIsModalOpen(false);
      setFormData(emptyForm);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível criar o acesso.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (user: SystemUser) => {
    if (pendingUserId) return;
    setPendingUserId(user.id);
    setActionError(null);
    try {
      if (user.status === 'active') {
        await api.blockSystemUser(user.id);
      } else {
        await api.unblockSystemUser(user.id);
      }
      setUsers(prev => prev.map(u => u.id === user.id
        ? { ...u, status: u.status === 'active' ? 'blocked' : 'active' }
        : u));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível atualizar o status deste usuário.');
    } finally {
      setPendingUserId(null);
    }
  };

  const closeCredentialBanner = () => {
    setCreatedCredential(null);
    setCopied(false);
  };

  const handleCopyPassword = async () => {
    if (!createdCredential) return;
    try {
      await navigator.clipboard.writeText(createdCredential.temporaryPassword);
      setCopied(true);
    } catch {
      // Sem acesso à área de transferência (navegador/permite) — o admin
      // ainda pode selecionar e copiar manualmente o texto exibido.
    }
  };

  return (
    <div className="p-6 md:p-8 relative">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="max-w-6xl mx-auto"
      >
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-sm">
                <Shield size={20} />
              </div>
              <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight">Usuários e Acessos</h1>
            </div>
            <p className="text-muted mt-1 max-w-lg">
              Gerencie quem tem acesso ao sistema, crie novos logins e defina os módulos que cada um pode visualizar.
            </p>
          </div>
          {isAdmin && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={openNewModal}
              className="bg-primary hover:bg-primary/90 text-white px-6 py-3.5 rounded-xl font-medium transition-colors shadow-lg shadow-primary/20 flex items-center gap-2 w-full md:w-auto justify-center whitespace-nowrap"
            >
              <UserPlus size={18} />
              Novo Acesso
            </motion.button>
          )}
        </div>

        {/* Action Bar (Search) */}
        <div className="glass-panel p-2 rounded-2xl border border-border/60 mb-8 flex items-center shadow-sm">
          <div className="flex-1 flex items-center px-4">
            <Search size={20} className="text-primary/70 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar usuários por email, funcionário ou tipo de acesso..."
              className="w-full bg-transparent border-none px-4 py-3 text-base text-foreground placeholder:text-muted focus:outline-none focus:ring-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-1.5 rounded-full hover:bg-secondary/80 text-muted hover:text-foreground transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {loadError && (
          <div className="glass-panel rounded-3xl border border-red-500/30 bg-red-500/5 p-6 mb-6 text-red-600 dark:text-red-400 text-sm">
            {loadError}
          </div>
        )}

        {!isModalOpen && actionError && (
          <div className="glass-panel rounded-3xl border border-red-500/30 bg-red-500/5 p-6 mb-6 text-red-600 dark:text-red-400 text-sm flex items-start justify-between gap-4">
            <span>{actionError}</span>
            <button
              onClick={() => setActionError(null)}
              className="p-1.5 rounded-full hover:bg-red-500/10 text-red-600 dark:text-red-400 transition-colors shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Data Grid or Empty State */}
        <div className="glass-panel rounded-3xl border border-border/60 overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="py-24 flex items-center justify-center text-muted">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : filteredUsers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10">
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Login
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Vínculo
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Módulos
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Status
                    </th>
                    {isAdmin && (
                      <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">
                        Ações
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredUsers.map((user, index) => {
                      const linkedEmployee = user.employeeId ? employeeById.get(user.employeeId) : undefined;
                      return (
                        <motion.tr
                          key={user.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2, delay: index * 0.03 }}
                          className="hover:bg-secondary/40 transition-colors group"
                        >
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-accent border-2 border-background shadow-sm flex items-center justify-center text-white font-bold text-sm shrink-0">
                                {user.email.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-base font-heading font-bold text-foreground">
                                  {user.email}
                                </p>
                                <p className="text-sm text-muted">
                                  {user.role === 'admin' ? 'Administrador' : 'Funcionário'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-5 text-sm font-medium text-foreground/80">
                            {user.role === 'employee'
                              ? (linkedEmployee ? linkedEmployee.fullName : '(funcionário não encontrado)')
                              : 'Login administrativo'}
                          </td>
                          <td className="px-8 py-5">
                            {user.modules.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 max-w-xs">
                                {user.modules.map(m => (
                                  <span
                                    key={m}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-accent/10 text-accent border border-accent/20"
                                  >
                                    {moduleLabel(m)}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted">Nenhum módulo</span>
                            )}
                          </td>
                          <td className="px-8 py-5">
                            {user.status === 'active' ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                Ativo
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                Bloqueado
                              </span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="px-8 py-5 text-right w-40">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleToggleStatus(user)}
                                  disabled={pendingUserId === user.id}
                                  className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
                                    user.status === 'active'
                                      ? 'text-muted hover:text-orange-500 hover:bg-orange-500/10'
                                      : 'text-muted hover:text-green-600 hover:bg-green-500/10'
                                  }`}
                                  title={user.status === 'active' ? 'Bloquear Acesso' : 'Desbloquear Acesso'}
                                >
                                  {pendingUserId === user.id ? (
                                    <Loader2 size={16} className="animate-spin" />
                                  ) : user.status === 'active' ? (
                                    <ShieldOff size={16} />
                                  ) : (
                                    <ShieldCheck size={16} />
                                  )}
                                </button>
                              </div>
                            </td>
                          )}
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          ) : (
            /* Empty State */
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-24 px-6 text-center flex flex-col items-center justify-center"
            >
              <div className="w-20 h-20 bg-secondary/50 rounded-[2rem] flex items-center justify-center text-muted mb-6 rotate-12 shadow-sm border border-border/50">
                <FileQuestion size={40} />
              </div>
              <h3 className="text-xl font-heading font-bold text-foreground mb-2">Nenhum usuário encontrado</h3>
              <p className="text-muted max-w-md text-base">
                Não encontramos resultados para a sua busca. Tente alterar os filtros ou cadastre um novo acesso.
              </p>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Modal de Criação */}
      {isModalOpen && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeModal}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-2xl shadow-2xl pointer-events-auto relative overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
              <div className="flex items-center justify-between mb-6 mt-2">
                <h2 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
                  <UserPlus size={24} className="text-primary"/>
                  Novo Acesso
                </h2>
                <button
                  onClick={closeModal}
                  className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {actionError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
                  {actionError}
                </div>
              )}

              <form onSubmit={handleCreateUser} className="space-y-6">

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      E-mail (Login) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      autoFocus
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                      placeholder="joao@empresa.com"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      Tipo de Acesso <span className="text-red-500">*</span>
                    </label>
                    <CustomSelect
                      value={formData.role}
                      onChange={(val) => setFormData({ ...formData, role: val as UserFormState['role'], employeeId: '' })}
                      options={ROLE_OPTIONS}
                    />
                  </div>

                  {formData.role === 'employee' && (
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                        Funcionário <span className="text-red-500">*</span>
                      </label>
                      {availableEmployees.length > 0 ? (
                        <CustomSelect
                          value={formData.employeeId}
                          onChange={(val) => setFormData({ ...formData, employeeId: val })}
                          options={availableEmployees.map(e => ({ value: e.id, label: `${e.fullName} — ${e.department}` }))}
                          placeholder="Selecione um funcionário sem login..."
                        />
                      ) : (
                        <p className="text-sm text-muted bg-secondary/30 border border-border/40 rounded-xl px-4 py-3">
                          Todos os funcionários já possuem um login. Cadastre um novo funcionário primeiro.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-border/40 mt-4">
                  <label className="block text-xs font-bold text-foreground/80 mb-3 uppercase tracking-wider mt-4 flex items-center gap-2">
                    <Shield size={14} className="text-primary" />
                    Módulos Autorizados
                  </label>
                  <p className="text-xs text-muted mb-4">
                    Selecione quais áreas do sistema este usuário poderá visualizar e editar.
                  </p>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                    {AVAILABLE_MODULES.map(mod => {
                      const isSelected = formData.modules.includes(mod.id);
                      return (
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          type="button"
                          key={mod.id}
                          onClick={() => toggleModule(mod.id)}
                          className={`relative flex flex-col items-start p-4 rounded-xl border transition-all duration-200 h-full overflow-hidden w-full ${
                            isSelected
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border/60 bg-background hover:border-border hover:bg-secondary/30'
                          }`}
                        >
                          <div className="flex items-start justify-between w-full mb-3">
                            <div className={`p-2.5 rounded-lg transition-colors ${
                              isSelected ? 'bg-primary/10 text-primary' : 'bg-secondary/50 text-muted-foreground group-hover:text-foreground'
                            }`}>
                              {mod.icon}
                            </div>

                            {/* Check Circle */}
                            <div className={`shrink-0 w-5 h-5 mt-1 rounded-full border-2 flex items-center justify-center transition-all ${
                              isSelected ? 'border-primary bg-primary text-white' : 'border-border/80 bg-transparent'
                            }`}>
                              {isSelected && (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                          </div>
                          <span className={`text-sm font-bold text-left leading-tight w-full ${
                            isSelected ? 'text-primary' : 'text-foreground/80'
                          }`}>
                            {mod.label}
                          </span>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                <p className="text-xs text-muted bg-secondary/20 border border-border/40 rounded-xl px-4 py-3 flex items-center gap-2">
                  <KeyRound size={14} className="shrink-0" />
                  Uma senha temporária será gerada automaticamente e exibida uma única vez após a criação.
                </p>

                <div className="pt-6 flex gap-3 border-t border-border/40 mt-6">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={!isFormValid || isSaving}
                    className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                  >
                    {isSaving && <Loader2 size={16} className="animate-spin" />}
                    {isSaving ? 'Criando...' : 'Criar Acesso'}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Banner: senha temporária (uma única exibição, fecha só por ação explícita) */}
      {createdCredential && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-background/85 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-background border border-primary/30 rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl pointer-events-auto relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
              <div className="flex items-center gap-3 mb-4 mt-2">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <KeyRound size={20} />
                </div>
                <h2 className="text-xl font-heading font-bold text-foreground">
                  Acesso criado com sucesso
                </h2>
              </div>

              <p className="text-sm text-muted mb-4">
                Copie a senha temporária abaixo agora — ela não pode ser recuperada depois de fechar esta janela.
                O usuário deve trocá-la no primeiro acesso.
              </p>

              <div className="bg-secondary/20 border border-border/40 rounded-xl p-4 mb-4">
                <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Login</p>
                <p className="text-sm font-medium text-foreground mb-3 break-all">{createdCredential.email}</p>
                <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Senha Temporária</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-base font-bold text-foreground bg-background border border-border/60 rounded-lg px-3 py-2 break-all">
                    {createdCredential.temporaryPassword}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    className={`shrink-0 p-2.5 rounded-lg border transition-colors ${
                      copied
                        ? 'border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'border-border/60 text-muted hover:text-primary hover:border-primary/40'
                    }`}
                    title="Copiar senha"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={closeCredentialBanner}
                className="w-full py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 text-sm"
              >
                Já copiei, fechar
              </button>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

    </div>
  );
};

export default UsersManagement;
