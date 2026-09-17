import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, X, FileQuestion, Briefcase, ChevronRight, Check, Ban, RotateCcw, Loader2 } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import * as api from '../../lib/api';
import type { Role } from '../../lib/api';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';

const COLOR_SWATCHES = [
  '#3B82F6', '#A855F7', '#EC4899', '#EF4444',
  '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#2563EB',
];

const Roles = () => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Drawer state
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [isConfirmingDeactivate, setIsConfirmingDeactivate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [newRole, setNewRole] = useState({ name: '', department: '', colorHex: '#2563EB', description: '' });
  const [newRoleCustomFields, setNewRoleCustomFields] = useState<Record<string, unknown>>({});

  const loadRoles = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setRoles(await api.listRoles());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os cargos.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  useEscapeKey(() => {
    setSelectedRole(null);
    setIsModalOpen(false);
  });

  // Prevent background scrolling when Drawer/Modal is open
  useEffect(() => {
    if (isModalOpen || selectedRole) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isModalOpen, selectedRole]);

  // Reset deactivate confirmation when drawer changes
  useEffect(() => {
    setIsConfirmingDeactivate(false);
  }, [selectedRole]);

  const filteredRoles = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase().trim();
    if (!lowerQuery) return roles;
    return roles.filter(
      role =>
        role.name.toLowerCase().includes(lowerQuery) ||
        role.department.toLowerCase().includes(lowerQuery)
    );
  }, [roles, searchQuery]);

  const handleAddRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRole.name.trim() || !newRole.department.trim() || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const created = await api.createRole({
        name: newRole.name, department: newRole.department,
        colorHex: newRole.colorHex, description: newRole.description || undefined,
        customFields: newRoleCustomFields,
      });
      setRoles(prev => [...prev, created]);
      setNewRole({ name: '', department: '', colorHex: '#2563EB', description: '' });
      setNewRoleCustomFields({});
      setIsModalOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível criar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateRole = async (updatedRole: Role) => {
    setIsSaving(true);
    setActionError(null);
    try {
      const saved = await api.updateRole(updatedRole.id, {
        name: updatedRole.name, department: updatedRole.department,
        colorHex: updatedRole.colorHex, description: updatedRole.description,
        customFields: updatedRole.customFields,
      });
      setRoles(prev => prev.map(r => r.id === saved.id ? saved : r));
      setSelectedRole(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivateRole = async (id: string) => {
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.deactivateRole(id);
      setRoles(prev => prev.map(r => r.id === id ? updated : r));
      setSelectedRole(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível inativar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReactivateRole = async (id: string) => {
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.reactivateRole(id);
      setRoles(prev => prev.map(r => r.id === id ? updated : r));
      setSelectedRole(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível reativar o cargo.');
    } finally {
      setIsSaving(false);
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
            <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight">Gestão de Cargos</h1>
            <p className="text-muted mt-2 max-w-lg">
              Estruture a hierarquia da sua empresa. Os cargos definidos aqui serão utilizados no cadastro de funcionários.
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => { setActionError(null); setIsModalOpen(true); }}
            className="bg-primary hover:bg-primary/90 text-white px-6 py-3.5 rounded-xl font-medium transition-colors shadow-lg shadow-primary/20 flex items-center gap-2 w-full md:w-auto justify-center whitespace-nowrap"
          >
            <Plus size={18} />
            Novo Cargo
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
              placeholder="Buscar cargos por nome ou departamento..."
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
        {loadError && (
          <div className="glass-panel rounded-3xl border border-red-500/30 bg-red-500/5 p-6 mb-6 text-red-600 dark:text-red-400 text-sm">
            {loadError}
          </div>
        )}

        <div className="glass-panel rounded-3xl border border-border/60 overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="py-24 flex items-center justify-center text-muted">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : filteredRoles.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10">
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Cargo
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Departamento
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredRoles.map((role, index) => (
                      <motion.tr
                        key={role.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2, delay: index * 0.03 }}
                        onClick={() => { setActionError(null); setSelectedRole(role); }}
                        className="hover:bg-secondary/40 transition-colors group cursor-pointer"
                      >
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-secondary border border-border/50 flex items-center justify-center text-muted group-hover:text-primary group-hover:border-primary/30 group-hover:bg-primary/5 transition-all shadow-sm shrink-0">
                              <Briefcase size={18} />
                            </div>
                            <span className="text-base font-heading font-medium text-foreground group-hover:text-primary transition-colors">
                              {role.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium bg-secondary/60 text-foreground/80 border border-border/60 shadow-sm">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: role.colorHex }} />
                            {role.department}
                          </span>
                        </td>
                        <td className="px-8 py-6">
                          {role.active ? (
                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500" /> ATIVO
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-secondary text-foreground/60 border border-border/60">
                              <div className="w-1.5 h-1.5 rounded-full bg-foreground/40" /> INATIVO
                            </span>
                          )}
                        </td>
                        <td className="px-8 py-6 text-right">
                          <button
                            onClick={() => { setActionError(null); setSelectedRole(role); }}
                            className="inline-flex items-center gap-1 text-sm font-medium text-muted group-hover:text-primary transition-colors hover:bg-secondary px-4 py-2 rounded-xl"
                          >
                            Detalhes
                            <ChevronRight size={16} />
                          </button>
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
              <h3 className="text-xl font-heading font-bold text-foreground mb-2">Nenhum cargo encontrado</h3>
              <p className="text-muted max-w-md text-base">
                Não encontramos resultados para "{searchQuery}". Tente buscar por outros termos ou crie um novo cargo.
              </p>
              <button
                onClick={() => setSearchQuery('')}
                className="mt-8 text-primary font-medium hover:bg-primary/10 px-6 py-2.5 rounded-full transition-colors"
              >
                Limpar filtros
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* PORTALS FOR MODAL AND DRAWER */}

      {/* 1. Modal: Novo Cargo */}
      {isModalOpen && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl pointer-events-auto relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
                <div className="flex items-center justify-between mb-8 mt-2">
                  <h2 className="text-2xl font-heading font-bold text-foreground">Novo Cargo</h2>
                  <button
                    onClick={() => setIsModalOpen(false)}
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
                <form onSubmit={handleAddRole} className="space-y-6">
                  <div>
                    <label className="block text-sm font-semibold text-foreground/90 mb-2">
                      Nome do Cargo <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      autoFocus
                      value={newRole.name}
                      onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm placeholder:text-muted/60"
                      placeholder="Ex: Diretor de Arte"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-foreground/90 mb-2">
                      Departamento <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={newRole.department}
                      onChange={(e) => setNewRole({ ...newRole, department: e.target.value })}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm placeholder:text-muted/60"
                      placeholder="Ex: Criação"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-foreground/90 mb-2">Cor de Identificação</label>
                    <div className="flex flex-wrap gap-3 mb-3">
                      {COLOR_SWATCHES.map(hex => (
                        <button
                          key={hex} type="button"
                          onClick={() => setNewRole({ ...newRole, colorHex: hex })}
                          style={{ backgroundColor: hex }}
                          className={`w-9 h-9 rounded-full transition-transform flex items-center justify-center ${newRole.colorHex === hex ? 'ring-4 ring-primary/30 scale-110' : 'hover:scale-105 opacity-90'}`}
                        >
                          {newRole.colorHex === hex && <Check size={14} className="text-white" />}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text" value={newRole.colorHex}
                      onChange={(e) => setNewRole({ ...newRole, colorHex: e.target.value })}
                      pattern="^#[0-9A-Fa-f]{6}$" placeholder="#2563EB"
                      className="w-32 bg-background border border-border/80 rounded-xl px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-foreground/90 mb-2">Descrição (opcional)</label>
                    <textarea
                      rows={3} value={newRole.description}
                      onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                      className="w-full bg-background border border-border/80 rounded-xl p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                      placeholder="Atribuições e responsabilidades..."
                    />
                  </div>
                  <CustomFieldsFormSection entity="role" values={newRoleCustomFields} onChange={setNewRoleCustomFields} />
                  <div className="pt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="flex-1 py-4 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-base"
                    >
                      Cancelar
                    </button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={!newRole.name.trim() || !newRole.department.trim() || isSaving}
                      className="flex-1 py-4 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-base"
                    >
                      {isSaving ? 'Salvando...' : 'Salvar Cargo'}
                    </motion.button>
                  </div>
                </form>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

      {/* 2. Drawer: Detalhes do Cargo */}
      {selectedRole && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRole(null)}
              className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex justify-end pointer-events-none">
              <motion.div
                initial={{ x: "100%", opacity: 0.5 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0.5 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="bg-background border-l border-border/60 w-full max-w-lg h-full shadow-2xl pointer-events-auto flex flex-col"
              >
                {/* Drawer Header */}
                <div className="p-6 md:p-8 border-b border-border/40 flex flex-col gap-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-secondary text-foreground/80 border border-border/40 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: selectedRole.colorHex }} />
                        {selectedRole.department}
                      </span>
                      <h2 className="text-2xl font-heading font-bold text-foreground">
                        {selectedRole.name}
                      </h2>
                    </div>
                    <button
                      onClick={() => setSelectedRole(null)}
                      className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                {/* Drawer Body (Form) */}
                <div className="p-6 md:p-8 flex-1 overflow-y-auto">
                  <div className="space-y-8">

                    {/* Atribuições */}
                    <div>
                      <label className="block text-sm font-semibold text-foreground/90 mb-3">
                        Descrição das Atribuições
                      </label>
                      <p className="text-sm text-muted mb-3">
                        Defina o que este profissional faz no dia a dia. Isso ajuda no alinhamento de expectativas da equipe.
                      </p>
                      <textarea
                        rows={5}
                        value={selectedRole.description || ''}
                        onChange={(e) => setSelectedRole({ ...selectedRole, description: e.target.value })}
                        placeholder="Ex: Responsável por liderar as iniciativas de design da empresa, gerenciar o time de criação..."
                        className="w-full bg-background border border-border/80 rounded-xl p-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm placeholder:text-muted/50 resize-none"
                      />
                    </div>

                    {/* Cores */}
                    <div>
                      <label className="block text-sm font-semibold text-foreground/90 mb-3">
                        Cor de Identificação
                      </label>
                      <p className="text-sm text-muted mb-4">
                        Escolha uma cor para representar este cargo nos organogramas e tabelas.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {COLOR_SWATCHES.map(hex => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => setSelectedRole({ ...selectedRole, colorHex: hex })}
                            style={{ backgroundColor: hex }}
                            className={`w-10 h-10 rounded-full transition-transform flex items-center justify-center ${selectedRole.colorHex === hex ? 'ring-4 ring-primary/30 scale-110 shadow-lg' : 'hover:scale-105 shadow-sm opacity-90'}`}
                          >
                            {selectedRole.colorHex === hex && <Check size={16} className="text-white" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <CustomFieldsFormSection
                      entity="role"
                      values={selectedRole.customFields ?? {}}
                      onChange={(v) => setSelectedRole({ ...selectedRole, customFields: v })}
                    />

                  </div>
                </div>

                {/* Drawer Footer */}
                {actionError && (
                  <div className="mx-6 md:mx-8 mb-4 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-600 dark:text-red-400 text-sm">
                    {actionError}
                  </div>
                )}
                <div className="p-6 md:p-8 border-t border-border/40 bg-secondary/10 flex items-center justify-between gap-4">
                  {selectedRole.active ? (
                    isConfirmingDeactivate ? (
                      <motion.button
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                        onClick={() => handleDeactivateRole(selectedRole.id)}
                        onMouseLeave={() => setIsConfirmingDeactivate(false)}
                        disabled={isSaving}
                        className="px-5 py-3.5 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 text-sm flex items-center gap-2 disabled:opacity-60"
                      >
                        <Ban size={16} /> Confirmar Inativação
                      </motion.button>
                    ) : (
                      <button
                        onClick={() => setIsConfirmingDeactivate(true)}
                        className="px-5 py-3.5 rounded-xl font-medium text-red-500 hover:bg-red-500/10 transition-colors text-sm flex items-center gap-2"
                      >
                        <Ban size={16} /> Inativar Cargo
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => handleReactivateRole(selectedRole.id)}
                      disabled={isSaving}
                      className="px-5 py-3.5 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 text-sm flex items-center gap-2 disabled:opacity-60"
                    >
                      <RotateCcw size={16} /> Reativar Cargo
                    </button>
                  )}

                  <div className="flex gap-3 ml-auto">
                    <button onClick={() => setSelectedRole(null)} className="px-5 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm">
                      Cancelar
                    </button>
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => handleUpdateRole(selectedRole)}
                      disabled={isSaving}
                      className="px-5 py-3.5 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 text-sm disabled:opacity-60"
                    >
                      {isSaving ? 'Salvando...' : 'Salvar'}
                    </motion.button>
                  </div>
                </div>

              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

    </div>
  );
};

export default Roles;
