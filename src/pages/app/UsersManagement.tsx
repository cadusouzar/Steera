import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Search, X, UserPlus, FileQuestion, LayoutDashboard, HeartHandshake, Users,
  TrendingUp, Package, BarChart3, Loader2, KeyRound, Copy, Check, ShieldOff, ShieldCheck,
  Pencil, Trash2, AlertTriangle, Clock,
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

interface ModuleOption { id: string; label: string; icon: React.ReactNode }
interface ModuleGroup { id: string; groupLabel: string; groupIcon: React.ReactNode; options: ModuleOption[] }

// Ids em maiúsculo pra bater 1:1 com o enum `AppModule` do backend (backend/prisma/schema.prisma)
// — módulos valem igualmente pra login ADMIN e EMPLOYEE, então o mesmo seletor aparece nos dois
// casos. Módulos sem sub-divisão continuam soltos; RH e Ponto viraram grupos com dois
// sub-módulos independentes cada um (17/09/2026 — antes "RH" cobria Cargos/Funcionários/Ponto de
// uma vez só; ver DECISOES-TECNICAS no vault pro raciocínio completo).
const STANDALONE_MODULES: ModuleOption[] = [
  { id: 'DASHBOARD', label: 'Visão Geral', icon: <LayoutDashboard size={16}/> },
  { id: 'CLIENTES', label: 'Clientes', icon: <HeartHandshake size={16}/> },
  { id: 'COMERCIAL', label: 'Comercial', icon: <TrendingUp size={16}/> },
  { id: 'OPERACOES', label: 'Operações', icon: <Package size={16}/> },
  { id: 'FINANCAS', label: 'Finanças', icon: <BarChart3 size={16}/> },
];

const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: 'rh', groupLabel: 'Recursos Humanos', groupIcon: <Users size={16}/>,
    options: [
      { id: 'RH_CARGOS', label: 'Cargos', icon: <Users size={14}/> },
      { id: 'RH_FUNCIONARIOS', label: 'Funcionários', icon: <Users size={14}/> },
    ],
  },
  {
    id: 'ponto', groupLabel: 'Ponto', groupIcon: <Clock size={16}/>,
    options: [
      { id: 'PONTO_REGISTRO', label: 'Bater o próprio ponto', icon: <Clock size={14}/> },
      { id: 'PONTO_ADMINISTRACAO', label: 'Administração de Ponto', icon: <Clock size={14}/> },
    ],
  },
];

const ALL_MODULE_OPTIONS: ModuleOption[] = [...STANDALONE_MODULES, ...MODULE_GROUPS.flatMap(g => g.options)];
const moduleLabel = (id: string) => ALL_MODULE_OPTIONS.find(m => m.id === id)?.label ?? id;

// Cap de pills visíveis na tabela — sem isso, um login com muitos módulos (ex.: um ADMIN com todos
// os 9) fazia a linha da tabela crescer verticalmente sem limite conforme os badges quebravam linha
// dentro do `max-w-xs`. O resto vira um único badge "+N", com `title` listando os módulos ocultos —
// a lista completa (e editável) continua a um clique de distância no modal de "Editar módulos".
const MAX_VISIBLE_MODULE_PILLS = 3;

interface UserFormState {
  email: string;
  role: 'admin' | 'employee';
  employeeId: string;
  modules: string[];
}

const emptyForm: UserFormState = { email: '', role: 'admin', employeeId: '', modules: ['DASHBOARD'] };

// Grade de módulos reaproveitada pelos modais de criação E edição — evita duas cópias divergentes
// do mesmo seletor (achado ao planejar a edição de módulos, 17/09/2026).
const ModulesPicker: React.FC<{ selected: string[]; onToggle: (id: string) => void }> = ({ selected, onToggle }) => {
  const renderOption = (mod: ModuleOption) => {
    const isSelected = selected.includes(mod.id);
    return (
      <motion.button
        whileTap={{ scale: 0.97 }}
        type="button"
        key={mod.id}
        onClick={() => onToggle(mod.id)}
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
        <span className={`text-sm font-bold text-left leading-tight w-full ${isSelected ? 'text-primary' : 'text-foreground/80'}`}>
          {mod.label}
        </span>
      </motion.button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        {STANDALONE_MODULES.map(renderOption)}
      </div>
      {MODULE_GROUPS.map(group => (
        <div key={group.id}>
          <div className="flex items-center gap-2 text-xs font-bold text-muted uppercase tracking-wider mb-2">
            {group.groupIcon}
            {group.groupLabel}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {group.options.map(renderOption)}
          </div>
        </div>
      ))}
    </div>
  );
};

const UsersManagement = () => {
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
  const myHasFullPontoAccess = currentUser?.hasFullPontoAccess ?? false;

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
  const [pontoAccessSaving, setPontoAccessSaving] = useState<string | null>(null);

  // Edição de módulos de um login já existente (17/09/2026) — sem precisar bloquear e recriar.
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Exclusão de verdade (17/09/2026) — confirmação em duas etapas, nunca window.confirm().
  const [deletingUser, setDeletingUser] = useState<SystemUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Redefinição de senha por um admin (17/09/2026) — confirmação em duas etapas antes de gerar.
  const [resettingPasswordUser, setResettingPasswordUser] = useState<SystemUser | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Ver a lista completa de módulos de um login (17/09/2026) — a tabela só mostra os 3 primeiros
  // badges por linha (ver MAX_VISIBLE_MODULE_PILLS); clicar no badge "+N" abre isso em vez de só
  // depender do `title` (hover não existe em touch, e o usuário pediu algo clicável). Somente
  // leitura — quem quiser editar de fato usa "Editar Módulos" (ação de admin, botão separado).
  const [viewingModulesUser, setViewingModulesUser] = useState<SystemUser | null>(null);

  // Senha temporária devolvida pela criação OU por um reset de senha — só existe nessa única
  // resposta, nunca mais recuperável depois. Fica num banner que só some com ação explícita do
  // admin (nunca no backdrop/Escape), pra garantir que ele realmente copiou/anotou antes de perder
  // o valor.
  const [tempPasswordBanner, setTempPasswordBanner] = useState<{ email: string; temporaryPassword: string } | null>(null);
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
    if (editingUser) setEditingUser(null);
    if (deletingUser) setDeletingUser(null);
    if (resettingPasswordUser) setResettingPasswordUser(null);
    if (viewingModulesUser) setViewingModulesUser(null);
  });

  useEffect(() => {
    if (isModalOpen || editingUser || deletingUser || resettingPasswordUser || tempPasswordBanner || viewingModulesUser) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, editingUser, deletingUser, resettingPasswordUser, tempPasswordBanner, viewingModulesUser]);

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
      setTempPasswordBanner({ email: result.user.email, temporaryPassword: result.temporaryPassword });
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

  const togglePontoAccess = async (user: SystemUser) => {
    if (pontoAccessSaving) return;
    setPontoAccessSaving(user.id);
    setActionError(null);
    try {
      await api.updatePontoAccess(user.id, !user.hasFullPontoAccess);
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível atualizar o acesso ao Ponto deste usuário.');
    } finally {
      setPontoAccessSaving(null);
    }
  };

  const closeCredentialBanner = () => {
    setTempPasswordBanner(null);
    setCopied(false);
  };

  const handleCopyPassword = async () => {
    if (!tempPasswordBanner) return;
    try {
      await navigator.clipboard.writeText(tempPasswordBanner.temporaryPassword);
      setCopied(true);
    } catch {
      // Sem acesso à área de transferência (navegador/permite) — o admin
      // ainda pode selecionar e copiar manualmente o texto exibido.
    }
  };

  const openEditModal = (user: SystemUser) => {
    setEditingUser(user);
    setEditModules(user.modules);
    setActionError(null);
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setActionError(null);
  };

  const toggleEditModule = (moduleId: string) => {
    setEditModules(prev => (prev.includes(moduleId) ? prev.filter(m => m !== moduleId) : [...prev, moduleId]));
  };

  const handleSaveModules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser || isSavingEdit) return;
    setIsSavingEdit(true);
    setActionError(null);
    try {
      const updated = await api.updateSystemUser(editingUser.id, { modules: editModules });
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
      closeEditModal();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível atualizar os módulos deste usuário.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingUser || isDeleting) return;
    setIsDeleting(true);
    setActionError(null);
    try {
      await api.deleteSystemUser(deletingUser.id);
      setUsers(prev => prev.filter(u => u.id !== deletingUser.id));
      setDeletingUser(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível excluir este login.');
      setDeletingUser(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmResetPassword = async () => {
    if (!resettingPasswordUser || isResettingPassword) return;
    setIsResettingPassword(true);
    setActionError(null);
    try {
      const result = await api.resetSystemUserPassword(resettingPasswordUser.id);
      const email = resettingPasswordUser.email;
      setResettingPasswordUser(null);
      setTempPasswordBanner({ email, temporaryPassword: result.temporaryPassword });
      // Reset também reativa o login (sai de bloqueado/travado) e zera o contador de tentativas —
      // recarrega pra refletir o novo status na tabela sem precisar adivinhar o valor localmente.
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha deste usuário.');
      setResettingPasswordUser(null);
    } finally {
      setIsResettingPassword(false);
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
                                {user.role === 'admin' && (
                                  <div className="mt-1">
                                    {myHasFullPontoAccess ? (
                                      <button
                                        type="button"
                                        onClick={() => togglePontoAccess(user)}
                                        disabled={pontoAccessSaving === user.id}
                                        className="text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
                                      >
                                        {pontoAccessSaving === user.id
                                          ? 'Salvando...'
                                          : user.hasFullPontoAccess
                                            ? 'Acesso total ao Ponto — clique para restringir ao próprio time'
                                            : 'Restrito ao próprio time no Ponto — clique para dar acesso total'}
                                      </button>
                                    ) : (
                                      <span className="text-xs text-muted">
                                        {user.hasFullPontoAccess ? 'Acesso total ao Ponto' : 'Restrito ao próprio time no Ponto'}
                                      </span>
                                    )}
                                  </div>
                                )}
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
                                {user.modules.slice(0, MAX_VISIBLE_MODULE_PILLS).map(m => (
                                  <span
                                    key={m}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-accent/10 text-accent border border-accent/20"
                                  >
                                    {moduleLabel(m)}
                                  </span>
                                ))}
                                {user.modules.length > MAX_VISIBLE_MODULE_PILLS && (
                                  <button
                                    type="button"
                                    onClick={() => setViewingModulesUser(user)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-muted/20 text-muted border border-border/60 hover:bg-muted/30 hover:text-foreground transition-colors cursor-pointer"
                                    title={user.modules.slice(MAX_VISIBLE_MODULE_PILLS).map(moduleLabel).join(', ')}
                                  >
                                    +{user.modules.length - MAX_VISIBLE_MODULE_PILLS}
                                  </button>
                                )}
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
                            ) : user.status === 'locked' ? (
                              <span
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                title="Travado automaticamente por excesso de tentativas de senha erradas"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                Travado (tentativas)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                Bloqueado
                              </span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="px-8 py-5 text-right">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                <button
                                  onClick={() => openEditModal(user)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors text-muted hover:text-primary hover:bg-primary/10"
                                >
                                  <Pencil size={14} />
                                  Editar
                                </button>
                                <button
                                  onClick={() => setResettingPasswordUser(user)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors text-muted hover:text-primary hover:bg-primary/10"
                                >
                                  <KeyRound size={14} />
                                  Redefinir Senha
                                </button>
                                <button
                                  onClick={() => handleToggleStatus(user)}
                                  disabled={pendingUserId === user.id}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                                    user.status === 'active'
                                      ? 'text-muted hover:text-orange-500 hover:bg-orange-500/10'
                                      : 'text-muted hover:text-green-600 hover:bg-green-500/10'
                                  }`}
                                >
                                  {pendingUserId === user.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : user.status === 'active' ? (
                                    <ShieldOff size={14} />
                                  ) : (
                                    <ShieldCheck size={14} />
                                  )}
                                  {user.status === 'active' ? 'Bloquear' : 'Desbloquear'}
                                </button>
                                <button
                                  onClick={() => setDeletingUser(user)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors text-muted hover:text-red-600 hover:bg-red-500/10"
                                >
                                  <Trash2 size={14} />
                                  Excluir
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

                  <ModulesPicker selected={formData.modules} onToggle={toggleModule} />
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

      {/* Modal de Edição de Módulos (17/09/2026) — mesmo seletor da criação, sem os campos de
          e-mail/tipo/funcionário (imutáveis depois de criado, ver CLAUDE.md/DECISOES-TECNICAS). */}
      {editingUser && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeEditModal}
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
                <div>
                  <h2 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
                    <Pencil size={22} className="text-primary"/>
                    Editar Módulos
                  </h2>
                  <p className="text-sm text-muted mt-1 break-all">{editingUser.email}</p>
                </div>
                <button
                  onClick={closeEditModal}
                  className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              {actionError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
                  {actionError}
                </div>
              )}

              <form onSubmit={handleSaveModules} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-foreground/80 mb-3 uppercase tracking-wider flex items-center gap-2">
                    <Shield size={14} className="text-primary" />
                    Módulos Autorizados
                  </label>
                  <p className="text-xs text-muted mb-4">
                    Altera imediatamente o que este login pode visualizar e editar — não precisa recriar o acesso.
                  </p>
                  <ModulesPicker selected={editModules} onToggle={toggleEditModule} />
                </div>

                <div className="pt-6 flex gap-3 border-t border-border/40 mt-6">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={isSavingEdit}
                    className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                  >
                    {isSavingEdit && <Loader2 size={16} className="animate-spin" />}
                    {isSavingEdit ? 'Salvando...' : 'Salvar Módulos'}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Ver todos os módulos de um login (17/09/2026) — aberto clicando no badge "+N" da tabela.
          Só leitura (sem onToggle) — quem quiser editar usa "Editar Módulos", ação separada de admin. */}
      {viewingModulesUser && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setViewingModulesUser(null)}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl pointer-events-auto relative overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
                    <Shield size={20} className="text-primary"/>
                    Módulos Autorizados
                  </h2>
                  <p className="text-sm text-muted mt-1 break-all">{viewingModulesUser.email}</p>
                </div>
                <button
                  onClick={() => setViewingModulesUser(null)}
                  className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {viewingModulesUser.modules.map(m => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold bg-accent/10 text-accent border border-accent/20"
                  >
                    {moduleLabel(m)}
                  </span>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setViewingModulesUser(null)}
                className="w-full mt-6 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm"
              >
                Fechar
              </button>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Confirmação de exclusão (17/09/2026) — sempre explica o efeito antes de agir, nunca
          window.confirm(). Diferente de bloquear: some de vez, não é reversível. */}
      {deletingUser && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isDeleting && setDeletingUser(null)}
            className="fixed inset-0 z-[110] bg-background/85 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-background border border-red-500/30 rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl pointer-events-auto relative overflow-hidden"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                  <AlertTriangle size={20} />
                </div>
                <h2 className="text-xl font-heading font-bold text-foreground">Excluir este login?</h2>
              </div>
              <p className="text-sm text-muted mb-2">
                <span className="font-medium text-foreground break-all">{deletingUser.email}</span> vai ser excluído
                permanentemente — diferente de bloquear, essa ação não pode ser desfeita e o login some de vez da
                lista.
              </p>
              {actionError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 mb-4 text-red-600 dark:text-red-400 text-sm">
                  {actionError}
                </div>
              )}
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setDeletingUser(null)}
                  disabled={isDeleting}
                  className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="flex-1 py-3 rounded-xl font-bold bg-red-600 text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 disabled:opacity-50 text-sm flex items-center justify-center gap-2"
                >
                  {isDeleting && <Loader2 size={16} className="animate-spin" />}
                  {isDeleting ? 'Excluindo...' : 'Excluir Definitivamente'}
                </button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Confirmação de redefinição de senha (17/09/2026) — explica o efeito (nova senha
          temporária, sessões ativas encerradas) antes de gerar. */}
      {resettingPasswordUser && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isResettingPassword && setResettingPasswordUser(null)}
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
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <KeyRound size={20} />
                </div>
                <h2 className="text-xl font-heading font-bold text-foreground">Redefinir senha deste login?</h2>
              </div>
              <p className="text-sm text-muted mb-2">
                Uma nova senha temporária vai ser gerada para{' '}
                <span className="font-medium text-foreground break-all">{resettingPasswordUser.email}</span>. A senha
                atual deixa de funcionar, todas as sessões ativas desse login são encerradas, e ele será obrigado a
                trocar a senha no próximo acesso — use isso se o usuário esqueceu a senha ou teve o login travado por
                excesso de tentativas.
              </p>
              {actionError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 mb-4 text-red-600 dark:text-red-400 text-sm">
                  {actionError}
                </div>
              )}
              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setResettingPasswordUser(null)}
                  disabled={isResettingPassword}
                  className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmResetPassword}
                  disabled={isResettingPassword}
                  className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-50 text-sm flex items-center justify-center gap-2"
                >
                  {isResettingPassword && <Loader2 size={16} className="animate-spin" />}
                  {isResettingPassword ? 'Gerando...' : 'Redefinir Senha'}
                </button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Banner: senha temporária (uma única exibição, fecha só por ação explícita) — reaproveitado
          tanto pela criação de um login quanto pelo reset de senha de um já existente. */}
      {tempPasswordBanner && createPortal(
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
                  Senha temporária gerada
                </h2>
              </div>

              <p className="text-sm text-muted mb-4">
                Copie a senha temporária abaixo agora — ela não pode ser recuperada depois de fechar esta janela.
                O usuário deve trocá-la no primeiro acesso.
              </p>

              <div className="bg-secondary/20 border border-border/40 rounded-xl p-4 mb-4">
                <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Login</p>
                <p className="text-sm font-medium text-foreground mb-3 break-all">{tempPasswordBanner.email}</p>
                <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Senha Temporária</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-base font-bold text-foreground bg-background border border-border/60 rounded-lg px-3 py-2 break-all">
                    {tempPasswordBanner.temporaryPassword}
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
