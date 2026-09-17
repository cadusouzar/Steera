import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings, Plus, X, FileQuestion, Loader2, Pencil, Ban, RotateCcw, Trash2, AlertTriangle,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import CustomSelect from '../../components/CustomSelect';
import { getCurrentUser } from '../../lib/auth';
import * as api from '../../lib/api';
import type { CustomFieldDefinition, CustomFieldEntity, CustomFieldType } from '../../lib/api';
import { TYPE_LABELS } from '../../components/CustomFieldsFormSection';

const ENTITY_OPTIONS: { value: CustomFieldEntity; label: string }[] = [
  { value: 'client', label: 'Clientes' },
  { value: 'role', label: 'Cargos' },
  { value: 'employee', label: 'Funcionários' },
];

// Ícone + rótulo exatos combinados com o dono do produto para o seletor de
// tipo (cartões clicáveis do modal "Novo campo"). A ordem/conjunto de tipos
// vem de `TYPE_LABELS` (Task 10) — este mapa só refina o texto exibido,
// já que `TYPE_LABELS` tem rótulos mais genéricos (ex.: "Texto" pra TEXT e
// LONG_TEXT ao mesmo tempo) do que o combinado aqui.
const TYPE_PICKER: Record<CustomFieldType, { icon: string; label: string }> = {
  TEXT: { icon: '📝', label: 'Texto curto' },
  LONG_TEXT: { icon: '📄', label: 'Texto longo' },
  NUMBER: { icon: '🔢', label: 'Número' },
  CURRENCY: { icon: '💰', label: 'Valor em dinheiro' },
  DATE: { icon: '📅', label: 'Data' },
  DATETIME: { icon: '🕐', label: 'Data e hora' },
  BOOLEAN: { icon: '✅', label: 'Sim ou não' },
  SELECT: { icon: '📋', label: 'Lista de opções' },
  MULTI_SELECT: { icon: '☑️', label: 'Lista de opções (múltipla escolha)' },
  EMAIL: { icon: '📧', label: 'E-mail' },
  PHONE: { icon: '📞', label: 'Telefone' },
};

const CUSTOM_FIELD_TYPES = Object.keys(TYPE_LABELS) as CustomFieldType[];

const hasOptions = (type: CustomFieldType | null) => type === 'SELECT' || type === 'MULTI_SELECT';

const parseOptions = (text: string): string[] =>
  text.split(',').map(s => s.trim()).filter(Boolean);

interface CreateFormState {
  type: CustomFieldType | null;
  displayName: string;
  optionsText: string;
  required: boolean;
}

const emptyCreateForm: CreateFormState = { type: null, displayName: '', optionsText: '', required: false };

interface EditFormState {
  displayName: string;
  description: string;
  required: boolean;
  optionsText: string;
  displayOrder: number;
}

type ConfirmAction =
  | { kind: 'rename'; field: CustomFieldDefinition; newName: string }
  | { kind: 'deactivate'; field: CustomFieldDefinition }
  | { kind: 'reactivate'; field: CustomFieldDefinition }
  | { kind: 'delete'; field: CustomFieldDefinition; filledCount: number };

const CustomFieldsSettings = () => {
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';

  const [entity, setEntity] = useState<CustomFieldEntity>('client');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive'>('active');
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSavingCreate, setIsSavingCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm);

  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [countLoadingId, setCountLoadingId] = useState<string | null>(null);

  const loadDefinitions = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setDefinitions(await api.listCustomFieldDefinitions(entity));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os campos personalizados.');
    } finally {
      setIsLoading(false);
    }
  }, [entity]);

  useEffect(() => {
    loadDefinitions();
  }, [loadDefinitions]);

  useEscapeKey(() => {
    if (confirmAction) { setConfirmAction(null); return; }
    if (editingField) { setEditingField(null); return; }
    if (isCreateModalOpen) setIsCreateModalOpen(false);
  });

  useEffect(() => {
    if (isCreateModalOpen || editingField || confirmAction) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isCreateModalOpen, editingField, confirmAction]);

  useEffect(() => {
    setDeleteConfirmText('');
  }, [confirmAction]);

  const filteredDefinitions = useMemo(() => {
    const wantActive = statusFilter === 'active';
    return definitions
      .filter(d => d.active === wantActive)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [definitions, statusFilter]);

  // ---- Criar ----

  const openCreateModal = () => {
    setCreateForm(emptyCreateForm);
    setActionError(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setActionError(null);
  };

  const isCreateFormValid =
    createForm.type !== null &&
    createForm.displayName.trim() !== '' &&
    (!hasOptions(createForm.type) || parseOptions(createForm.optionsText).length > 0);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingCreate || !isCreateFormValid || !createForm.type) return;
    setIsSavingCreate(true);
    setActionError(null);
    try {
      const created = await api.createCustomFieldDefinition({
        entity,
        displayName: createForm.displayName.trim(),
        type: createForm.type,
        required: createForm.required,
        ...(hasOptions(createForm.type) ? { configuration: { options: parseOptions(createForm.optionsText) } } : {}),
      });
      setDefinitions(prev => [...prev, created]);
      setIsCreateModalOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível criar o campo.');
    } finally {
      setIsSavingCreate(false);
    }
  };

  // ---- Editar ----

  const openEditModal = (field: CustomFieldDefinition) => {
    setEditingField(field);
    setEditForm({
      displayName: field.displayName,
      description: field.description ?? '',
      required: field.required,
      optionsText: (field.configuration?.options ?? []).join(', '),
      displayOrder: field.displayOrder,
    });
    setActionError(null);
  };

  const closeEditModal = () => {
    setEditingField(null);
    setEditForm(null);
    setActionError(null);
  };

  const isEditFormValid =
    !!editForm &&
    editForm.displayName.trim() !== '' &&
    (!editingField || !hasOptions(editingField.type) || parseOptions(editForm.optionsText).length > 0);

  const performEditSave = async (field: CustomFieldDefinition, form: EditFormState) => {
    setIsSavingEdit(true);
    setActionError(null);
    try {
      const updated = await api.updateCustomFieldDefinition(field.id, {
        displayName: form.displayName.trim(),
        description: form.description.trim(),
        required: form.required,
        displayOrder: form.displayOrder,
        ...(hasOptions(field.type) ? { configuration: { options: parseOptions(form.optionsText) } } : {}),
      });
      setDefinitions(prev => prev.map(d => d.id === updated.id ? updated : d));
      setEditingField(null);
      setEditForm(null);
      setConfirmAction(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar as alterações deste campo.');
      setConfirmAction(null);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingField || !editForm || isSavingEdit || !isEditFormValid) return;
    const trimmedName = editForm.displayName.trim();
    if (trimmedName !== editingField.displayName) {
      // Renomear tem confirmação própria (texto combinado com o dono do
      // produto) — as demais mudanças (descrição/obrigatório/opções/ordem)
      // salvam direto, sem esse passo extra.
      setConfirmAction({ kind: 'rename', field: editingField, newName: trimmedName });
      return;
    }
    performEditSave(editingField, editForm);
  };

  // ---- Desativar / Reativar / Excluir ----

  const handleDeactivateClick = (field: CustomFieldDefinition) => {
    setActionError(null);
    setConfirmAction({ kind: 'deactivate', field });
  };

  const handleReactivateClick = (field: CustomFieldDefinition) => {
    setActionError(null);
    setConfirmAction({ kind: 'reactivate', field });
  };

  const handleDeleteClick = async (field: CustomFieldDefinition) => {
    if (countLoadingId) return;
    setActionError(null);
    setCountLoadingId(field.id);
    try {
      const filledCount = await api.getCustomFieldFilledCount(field.id);
      setConfirmAction({ kind: 'delete', field, filledCount });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível verificar os dados preenchidos deste campo.');
    } finally {
      setCountLoadingId(null);
    }
  };

  const isDeleteConfirmValid =
    !!confirmAction &&
    confirmAction.kind === 'delete' &&
    (confirmAction.filledCount === 0 || deleteConfirmText === confirmAction.field.displayName);

  const handleConfirm = async () => {
    if (!confirmAction || isConfirmBusy) return;

    if (confirmAction.kind === 'rename') {
      if (!editForm) return;
      await performEditSave(confirmAction.field, editForm);
      return;
    }

    setIsConfirmBusy(true);
    setActionError(null);
    try {
      if (confirmAction.kind === 'deactivate') {
        const updated = await api.deactivateCustomFieldDefinition(confirmAction.field.id);
        setDefinitions(prev => prev.map(d => d.id === updated.id ? updated : d));
      } else if (confirmAction.kind === 'reactivate') {
        const updated = await api.activateCustomFieldDefinition(confirmAction.field.id);
        setDefinitions(prev => prev.map(d => d.id === updated.id ? updated : d));
      } else if (confirmAction.kind === 'delete') {
        if (!isDeleteConfirmValid) return;
        const deletedId = confirmAction.field.id;
        await api.deleteCustomFieldDefinition(deletedId);
        setDefinitions(prev => prev.filter(d => d.id !== deletedId));
      }
      setConfirmAction(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível concluir esta ação.');
    } finally {
      setIsConfirmBusy(false);
    }
  };

  return (
    <div className="p-6 md:p-8 relative">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="max-w-6xl mx-auto"
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-sm">
                <Settings size={20} />
              </div>
              <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight">Campos Personalizados</h1>
            </div>
            <p className="text-muted mt-1 max-w-lg">
              Adicione campos próprios aos cadastros de Clientes, Cargos e Funcionários, sem precisar de código novo.
            </p>
          </div>
          {isAdmin && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={openCreateModal}
              className="bg-primary hover:bg-primary/90 text-white px-6 py-3.5 rounded-xl font-medium transition-colors shadow-lg shadow-primary/20 flex items-center gap-2 w-full md:w-auto justify-center whitespace-nowrap"
            >
              <Plus size={18} />
              Novo Campo
            </motion.button>
          )}
        </div>

        {/* Action Bar: entidade + status */}
        <div className="glass-panel p-4 rounded-2xl border border-border/60 mb-8 flex flex-col md:flex-row md:items-center gap-4 shadow-sm">
          <div className="w-full md:w-64">
            <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1.5">
              Cadastro
            </label>
            <CustomSelect
              value={entity}
              onChange={(val) => setEntity(val as CustomFieldEntity)}
              options={ENTITY_OPTIONS}
            />
          </div>
          <div className="flex items-center gap-2 md:ml-auto">
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                statusFilter === 'active'
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'text-muted border border-transparent hover:bg-secondary/50'
              }`}
            >
              Ativos
            </button>
            <button
              onClick={() => setStatusFilter('inactive')}
              className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                statusFilter === 'inactive'
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'text-muted border border-transparent hover:bg-secondary/50'
              }`}
            >
              Desativados
            </button>
          </div>
        </div>

        {loadError && (
          <div className="glass-panel rounded-3xl border border-red-500/30 bg-red-500/5 p-6 mb-6 text-red-600 dark:text-red-400 text-sm">
            {loadError}
          </div>
        )}

        {!isCreateModalOpen && !editingField && !confirmAction && actionError && (
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

        {/* Tabela */}
        <div className="glass-panel rounded-3xl border border-border/60 overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="py-24 flex items-center justify-center text-muted">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : filteredDefinitions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10">
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Nome</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Tipo</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Obrigatório</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Ordem</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Status</th>
                    {isAdmin && (
                      <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Ações</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredDefinitions.map((field, index) => (
                      <motion.tr
                        key={field.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2, delay: index * 0.03 }}
                        className="hover:bg-secondary/40 transition-colors group"
                      >
                        <td className="px-8 py-5">
                          <p className="text-base font-heading font-bold text-foreground">{field.displayName}</p>
                          {field.description && (
                            <p className="text-sm text-muted mt-0.5">{field.description}</p>
                          )}
                        </td>
                        <td className="px-8 py-5">
                          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium bg-secondary/60 text-foreground/80 border border-border/60 shadow-sm">
                            <span>{TYPE_PICKER[field.type].icon}</span>
                            {TYPE_PICKER[field.type].label}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-sm font-medium text-foreground/80">
                          {field.required ? 'Sim' : 'Não'}
                        </td>
                        <td className="px-8 py-5 text-sm font-medium text-foreground/80">
                          {field.displayOrder}
                        </td>
                        <td className="px-8 py-5">
                          {field.active ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              Ativo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-secondary text-foreground/60 border border-border/60">
                              <span className="w-1.5 h-1.5 rounded-full bg-foreground/40" />
                              Inativo
                            </span>
                          )}
                        </td>
                        {isAdmin && (
                          <td className="px-8 py-5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => openEditModal(field)}
                                className="p-2 rounded-lg transition-colors text-muted hover:text-primary hover:bg-primary/10"
                                title="Editar"
                              >
                                <Pencil size={16} />
                              </button>
                              {field.active ? (
                                <button
                                  onClick={() => handleDeactivateClick(field)}
                                  className="p-2 rounded-lg transition-colors text-muted hover:text-orange-500 hover:bg-orange-500/10"
                                  title="Desativar"
                                >
                                  <Ban size={16} />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleReactivateClick(field)}
                                  className="p-2 rounded-lg transition-colors text-muted hover:text-green-600 hover:bg-green-500/10"
                                  title="Reativar"
                                >
                                  <RotateCcw size={16} />
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteClick(field)}
                                disabled={countLoadingId === field.id}
                                className="p-2 rounded-lg transition-colors text-muted hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                                title="Excluir"
                              >
                                {countLoadingId === field.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                              </button>
                            </div>
                          </td>
                        )}
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-24 px-6 text-center flex flex-col items-center justify-center"
            >
              <div className="w-20 h-20 bg-secondary/50 rounded-[2rem] flex items-center justify-center text-muted mb-6 rotate-12 shadow-sm border border-border/50">
                <FileQuestion size={40} />
              </div>
              <h3 className="text-xl font-heading font-bold text-foreground mb-2">
                {statusFilter === 'active' ? 'Nenhum campo ativo' : 'Nenhum campo desativado'}
              </h3>
              <p className="text-muted max-w-md text-base">
                {statusFilter === 'active'
                  ? 'Ainda não existe nenhum campo personalizado ativo para este cadastro. Crie o primeiro clicando em "Novo Campo".'
                  : 'Nenhum campo personalizado deste cadastro está desativado no momento.'}
              </p>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Modal: Novo Campo */}
      {isCreateModalOpen && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCreateModal}
            className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-2xl shadow-2xl pointer-events-auto relative overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
              <div className="flex items-center justify-between mb-6 mt-2">
                <h2 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
                  <Plus size={24} className="text-primary" />
                  Novo Campo — {ENTITY_OPTIONS.find(o => o.value === entity)?.label}
                </h2>
                <button
                  onClick={closeCreateModal}
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

              <form onSubmit={handleCreateSubmit} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-foreground/80 mb-3 uppercase tracking-wider">
                    Tipo de Campo <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {CUSTOM_FIELD_TYPES.map(type => {
                      const isSelected = createForm.type === type;
                      return (
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          type="button"
                          key={type}
                          onClick={() => setCreateForm(prev => ({ ...prev, type }))}
                          className={`flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all duration-200 ${
                            isSelected
                              ? 'border-primary bg-primary/5 shadow-sm'
                              : 'border-border/60 bg-background hover:border-border hover:bg-secondary/30'
                          }`}
                        >
                          <span className="text-2xl leading-none">{TYPE_PICKER[type].icon}</span>
                          <span className={`text-sm font-bold leading-tight ${isSelected ? 'text-primary' : 'text-foreground/80'}`}>
                            {TYPE_PICKER[type].label}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                    Nome do Campo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.displayName}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, displayName: e.target.value }))}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                    placeholder="Ex: Data de aniversário"
                  />
                </div>

                {hasOptions(createForm.type) && (
                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      Opções (separadas por vírgula) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={createForm.optionsText}
                      onChange={(e) => setCreateForm(prev => ({ ...prev, optionsText: e.target.value }))}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                      placeholder="Ex: Ouro, Prata, Bronze"
                    />
                  </div>
                )}

                <label className="flex items-center gap-2.5 text-sm font-medium text-foreground/90 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={createForm.required}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, required: e.target.checked }))}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  Obrigatório
                </label>

                <div className="pt-6 flex gap-3 border-t border-border/40 mt-6">
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={!isCreateFormValid || isSavingCreate}
                    className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                  >
                    {isSavingCreate && <Loader2 size={16} className="animate-spin" />}
                    {isSavingCreate ? 'Criando...' : 'Criar Campo'}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Modal: Editar Campo */}
      {editingField && editForm && createPortal(
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
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-2xl shadow-2xl pointer-events-auto relative overflow-hidden max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
              <div className="flex items-center justify-between mb-6 mt-2">
                <h2 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
                  <Pencil size={22} className="text-primary" />
                  Editar Campo
                </h2>
                <button
                  onClick={closeEditModal}
                  className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <p className="text-xs text-muted mb-6 flex items-center gap-2">
                <span>{TYPE_PICKER[editingField.type].icon}</span>
                {TYPE_PICKER[editingField.type].label} — o tipo não pode ser alterado depois de criado.
              </p>

              {actionError && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
                  {actionError}
                </div>
              )}

              <form onSubmit={handleEditSubmit} className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                    Nome do Campo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.displayName}
                    onChange={(e) => setEditForm(prev => prev && { ...prev, displayName: e.target.value })}
                    className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                    Descrição
                  </label>
                  <textarea
                    rows={2}
                    value={editForm.description}
                    onChange={(e) => setEditForm(prev => prev && { ...prev, description: e.target.value })}
                    className="w-full bg-background border border-border/80 rounded-xl p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                    placeholder="Texto de ajuda exibido junto ao campo (opcional)"
                  />
                </div>

                {hasOptions(editingField.type) && (
                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      Opções (separadas por vírgula) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editForm.optionsText}
                      onChange={(e) => setEditForm(prev => prev && { ...prev, optionsText: e.target.value })}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                      Ordem de Exibição
                    </label>
                    <input
                      type="number"
                      value={editForm.displayOrder}
                      onChange={(e) => setEditForm(prev => prev && { ...prev, displayOrder: Number(e.target.value) })}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2.5 text-sm font-medium text-foreground/90 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={editForm.required}
                        onChange={(e) => setEditForm(prev => prev && { ...prev, required: e.target.checked })}
                        className="w-4 h-4 rounded accent-primary"
                      />
                      Obrigatório
                    </label>
                  </div>
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
                    disabled={!isEditFormValid || isSavingEdit}
                    className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                  >
                    {isSavingEdit && <Loader2 size={16} className="animate-spin" />}
                    {isSavingEdit ? 'Salvando...' : 'Salvar'}
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}

      {/* Modal: Confirmações (renomear / desativar / reativar / excluir) */}
      {confirmAction && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !isConfirmBusy && setConfirmAction(null)}
            className="fixed inset-0 z-[110] bg-background/80 backdrop-blur-sm"
          />
          <div className="fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl pointer-events-auto relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 right-0 h-1.5 opacity-80 ${
                confirmAction.kind === 'delete' ? 'bg-red-500' : confirmAction.kind === 'deactivate' ? 'bg-orange-500' : 'bg-gradient-to-r from-primary via-accent to-primary'
              }`} />

              <div className="flex items-center gap-3 mb-4 mt-2">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  confirmAction.kind === 'delete'
                    ? 'bg-red-500/10 text-red-500'
                    : confirmAction.kind === 'deactivate'
                      ? 'bg-orange-500/10 text-orange-500'
                      : 'bg-primary/10 text-primary'
                }`}>
                  {confirmAction.kind === 'delete' && <Trash2 size={20} />}
                  {confirmAction.kind === 'deactivate' && <Ban size={20} />}
                  {confirmAction.kind === 'reactivate' && <RotateCcw size={20} />}
                  {confirmAction.kind === 'rename' && <Pencil size={20} />}
                </div>
                <h2 className="text-xl font-heading font-bold text-foreground">
                  {confirmAction.kind === 'rename' && 'Confirmar renomeação'}
                  {confirmAction.kind === 'deactivate' && 'Desativar campo'}
                  {confirmAction.kind === 'reactivate' && 'Reativar campo'}
                  {confirmAction.kind === 'delete' && 'Excluir campo'}
                </h2>
              </div>

              {confirmAction.kind === 'rename' && (
                <p className="text-sm text-foreground/90 mb-6">
                  O campo vai passar a se chamar '{confirmAction.newName}'. Os dados já preenchidos não mudam.
                </p>
              )}

              {confirmAction.kind === 'deactivate' && (
                <p className="text-sm text-foreground/90 mb-6">
                  O campo '{confirmAction.field.displayName}' vai parar de aparecer em novos cadastros. Os dados que já
                  existem continuam guardados e voltam a aparecer se você reativar este campo depois.
                </p>
              )}

              {confirmAction.kind === 'reactivate' && (
                <p className="text-sm text-foreground/90 mb-6">
                  O campo '{confirmAction.field.displayName}' volta a aparecer nos formulários, com os dados que já
                  estavam preenchidos.
                </p>
              )}

              {confirmAction.kind === 'delete' && confirmAction.filledCount > 0 && (
                <>
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 dark:text-red-400 text-sm flex items-start gap-2.5">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <span>
                      Este campo tem dados preenchidos em {confirmAction.filledCount} registros. Excluir apaga esses
                      dados PARA SEMPRE, sem volta.
                    </span>
                  </div>
                  <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
                    Digite <span className="font-mono normal-case">{confirmAction.field.displayName}</span> para confirmar
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="w-full bg-background border border-red-500/40 rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/40 transition-all shadow-sm mb-6"
                    placeholder={confirmAction.field.displayName}
                  />
                </>
              )}

              {confirmAction.kind === 'delete' && confirmAction.filledCount === 0 && (
                <p className="text-sm text-foreground/90 mb-6">
                  Tem certeza que deseja excluir o campo '{confirmAction.field.displayName}'? Esta ação não pode ser desfeita.
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  disabled={isConfirmBusy}
                  className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm disabled:opacity-50"
                >
                  Cancelar
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleConfirm}
                  disabled={isConfirmBusy || (confirmAction.kind === 'delete' && !isDeleteConfirmValid)}
                  className={`flex-1 py-3 rounded-xl font-bold text-white transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2 ${
                    confirmAction.kind === 'delete'
                      ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20'
                      : 'bg-primary hover:bg-primary/90 shadow-primary/20'
                  }`}
                >
                  {isConfirmBusy && <Loader2 size={16} className="animate-spin" />}
                  {confirmAction.kind === 'rename' && (isConfirmBusy ? 'Salvando...' : 'Confirmar')}
                  {confirmAction.kind === 'deactivate' && (isConfirmBusy ? 'Desativando...' : 'Confirmar Desativação')}
                  {confirmAction.kind === 'reactivate' && (isConfirmBusy ? 'Reativando...' : 'Confirmar Reativação')}
                  {confirmAction.kind === 'delete' && (isConfirmBusy ? 'Excluindo...' : 'Excluir Definitivamente')}
                </motion.button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export default CustomFieldsSettings;
