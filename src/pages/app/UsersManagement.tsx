import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Plus, Search, X, Edit, Trash2, UserPlus, Key, AlertCircle, FileQuestion, LayoutDashboard, HeartHandshake, Users, TrendingUp, Package, BarChart3 } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import CustomSelect from '../../components/CustomSelect';

interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: string;
  modules: string[];
  status: 'active' | 'blocked';
  lastLogin: string;
}

const mockUsers: SystemUser[] = [
  { id: '1', name: 'Carlos Eduardo', email: 'carlos@exemplo.com', role: 'Administrador', modules: ['dashboard', 'clientes', 'rh', 'comercial', 'operacoes', 'financas'], status: 'active', lastLogin: 'Hoje, 10:45' },
  { id: '2', name: 'Mariana Silva', email: 'mariana@exemplo.com', role: 'Gerente de Vendas', modules: ['dashboard', 'clientes', 'comercial'], status: 'active', lastLogin: 'Ontem, 16:30' },
  { id: '3', name: 'João Souza', email: 'joao@exemplo.com', role: 'Analista de RH', modules: ['dashboard', 'rh'], status: 'active', lastLogin: '12/08/2023' },
  { id: '4', name: 'Fernanda Costa', email: 'fernanda@exemplo.com', role: 'Estoque', modules: ['dashboard', 'operacoes'], status: 'blocked', lastLogin: 'Nunca' },
];

const AVAILABLE_ROLES = [
  { value: 'Administrador', label: 'Administrador' },
  { value: 'Gerente de Vendas', label: 'Gerente de Vendas' },
  { value: 'Analista de RH', label: 'Analista de RH' },
  { value: 'Desenvolvedor Front-end', label: 'Desenvolvedor Front-end' },
  { value: 'Estoque', label: 'Estoque' },
  { value: 'Visualizador', label: 'Visualizador' }
];

const AVAILABLE_MODULES = [
  { id: 'dashboard', label: 'Visão Geral', icon: <LayoutDashboard size={16}/> },
  { id: 'clientes', label: 'Clientes', icon: <HeartHandshake size={16}/> },
  { id: 'rh', label: 'Recursos Humanos', icon: <Users size={16}/> },
  { id: 'comercial', label: 'Comercial', icon: <TrendingUp size={16}/> },
  { id: 'operacoes', label: 'Operações', icon: <Package size={16}/> },
  { id: 'financas', label: 'Finanças', icon: <BarChart3 size={16}/> },
];

const UsersManagement = () => {
  const [users, setUsers] = useState<SystemUser[]>(mockUsers);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // For Editing/Deleting
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState<string | null>(null);

  // New User Form State
  const [formData, setFormData] = useState({ name: '', email: '', role: 'Visualizador', password: '', modules: ['dashboard'] as string[] });

  useEscapeKey(() => {
    if (isModalOpen) setIsModalOpen(false);
    if (editingUser) setEditingUser(null);
  });

  useEffect(() => {
    if (isModalOpen || editingUser) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, editingUser]);

  const filteredUsers = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase().trim();
    if (!lowerQuery) return users;
    return users.filter(
      u => u.name.toLowerCase().includes(lowerQuery) || u.email.toLowerCase().includes(lowerQuery) || u.role.toLowerCase().includes(lowerQuery)
    );
  }, [users, searchQuery]);

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      // Update
      setUsers(users.map(u => u.id === editingUser.id ? { ...u, ...formData } : u));
      setEditingUser(null);
    } else {
      // Create
      const newUser: SystemUser = {
        id: crypto.randomUUID(),
        name: formData.name,
        email: formData.email,
        role: formData.role,
        modules: formData.modules,
        status: 'active',
        lastLogin: 'Nunca'
      };
      setUsers([...users, newUser]);
      setIsModalOpen(false);
    }
    setFormData({ name: '', email: '', role: 'Visualizador', password: '', modules: ['dashboard'] });
  };

  const openNewModal = () => {
    setFormData({ name: '', email: '', role: 'Visualizador', password: '', modules: ['dashboard'] });
    setIsModalOpen(true);
  };

  const openEditModal = (user: SystemUser) => {
    setFormData({ name: user.name, email: user.email, role: user.role, password: '', modules: user.modules || ['dashboard'] });
    setEditingUser(user);
  };

  const handleDelete = (id: string) => {
    setUsers(users.filter(u => u.id !== id));
    setIsConfirmingDelete(null);
  };

  const toggleStatus = (id: string) => {
    setUsers(users.map(u => {
      if (u.id === id) {
        return { ...u, status: u.status === 'active' ? 'blocked' : 'active' };
      }
      return u;
    }));
  };

  const toggleModule = (moduleId: string) => {
    setFormData(prev => {
      const isSelected = prev.modules.includes(moduleId);
      if (isSelected) {
        return { ...prev, modules: prev.modules.filter(m => m !== moduleId) };
      }
      return { ...prev, modules: [...prev.modules, moduleId] };
    });
  };

  const isFormValid = formData.name.trim() && formData.email.trim() && (editingUser || formData.password.trim());

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
              Gerencie quem tem acesso ao sistema, crie novas contas e defina os cargos para restringir a visualização de módulos.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={openNewModal}
            className="bg-primary hover:bg-primary/90 text-white px-6 py-3.5 rounded-xl font-medium transition-colors shadow-lg shadow-primary/20 flex items-center gap-2 w-full md:w-auto justify-center whitespace-nowrap"
          >
            <UserPlus size={18} />
            Novo Acesso
          </motion.button>
        </div>

        {/* Action Bar (Search) */}
        <div className="glass-panel p-2 rounded-2xl border border-border/60 mb-8 flex items-center shadow-sm">
          <div className="flex-1 flex items-center px-4">
            <Search size={20} className="text-primary/70 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar usuários por nome, email ou cargo..."
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

        {/* Data Grid or Empty State */}
        <div className="glass-panel rounded-3xl border border-border/60 overflow-hidden shadow-sm">
          {filteredUsers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10">
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Usuário
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Cargo / Acesso
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Último Login
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredUsers.map((user, index) => (
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
                              {user.name.charAt(0)}
                            </div>
                            <div>
                              <p className="text-base font-heading font-bold text-foreground">
                                {user.name}
                              </p>
                              <p className="text-sm text-muted">
                                {user.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-accent/10 text-accent border border-accent/20">
                            {user.role}
                          </span>
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
                        <td className="px-8 py-5 text-sm font-medium text-foreground/80">
                          {user.lastLogin}
                        </td>
                        <td className="px-8 py-5 text-right w-48">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => toggleStatus(user.id)}
                              className="p-2 text-muted hover:text-orange-500 hover:bg-orange-500/10 rounded-lg transition-colors"
                              title={user.status === 'active' ? 'Bloquear Acesso' : 'Desbloquear Acesso'}
                            >
                              <Shield size={16} />
                            </button>
                            <button 
                              onClick={() => openEditModal(user)}
                              className="p-2 text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                              title="Editar Usuário"
                            >
                              <Edit size={16} />
                            </button>
                            
                            <div className="relative flex items-center justify-end min-w-[32px] min-h-[32px]">
                              {isConfirmingDelete === user.id ? (
                                <motion.button 
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  onClick={() => handleDelete(user.id)}
                                  onMouseLeave={() => setIsConfirmingDelete(null)}
                                  className="absolute right-0 px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg shadow-sm whitespace-nowrap z-10"
                                >
                                  Excluir?
                                </motion.button>
                              ) : (
                                <button 
                                  onClick={() => setIsConfirmingDelete(user.id)}
                                  className="p-2 text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors absolute right-0"
                                  title="Excluir Usuário"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
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

      {/* Modal de Criação / Edição */}
      {(isModalOpen || editingUser) && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setIsModalOpen(false); setEditingUser(null); }}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-2xl shadow-2xl pointer-events-auto relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
              <div className="flex items-center justify-between mb-6 mt-2">
                <h2 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
                  {editingUser ? <Edit size={24} className="text-primary"/> : <UserPlus size={24} className="text-primary"/>}
                  {editingUser ? 'Editar Usuário' : 'Novo Acesso'}
                </h2>
                <button
                  onClick={() => { setIsModalOpen(false); setEditingUser(null); }}
                  className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <form onSubmit={handleSaveUser} className="space-y-6">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      Nome Completo <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                      placeholder="Ex: João Silva"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      E-mail (Login) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                      placeholder="joao@empresa.com"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      Cargo / Nível de Acesso <span className="text-red-500">*</span>
                    </label>
                    <CustomSelect
                      value={formData.role}
                      onChange={(val) => setFormData({ ...formData, role: val })}
                      options={AVAILABLE_ROLES}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      {editingUser ? 'Nova Senha (opcional)' : 'Senha Temporária'} {!editingUser && <span className="text-red-500">*</span>}
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted">
                        <Key size={16} />
                      </div>
                      <input
                        type="password"
                        required={!editingUser}
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-background border border-border/80 rounded-xl pl-10 pr-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
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

                <div className="pt-6 flex gap-3 border-t border-border/40 mt-6">
                  <button
                    type="button"
                    onClick={() => { setIsModalOpen(false); setEditingUser(null); }}
                    className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={!isFormValid}
                    className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {editingUser ? 'Salvar Alterações' : 'Criar Conta'}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

    </div>
  );
};

export default UsersManagement;
