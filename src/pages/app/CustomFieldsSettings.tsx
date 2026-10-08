import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  AlignLeft, Ban, Banknote, Briefcase, Building2, Calendar, CalendarClock, Hash, HeartHandshake, List, ListChecks,
  Mail, Package, Pencil, Phone, Plus, RotateCcw, SquareUser, ToggleLeft, Trash2, Type, Users, X, type LucideIcon,
} from 'lucide-react';
import {
  Button, ConfirmDialog, EmptyState, Field, Input, Menu, Modal, Notice, PageHeader, SegmentedControl, Switch,
  Table, TBody, TD, TH, THead, TR, Tabs, Textarea, toast, type MenuItem,
} from '../../components/ui';
import { can, useCurrentUser } from '../../lib/auth';
import * as api from '../../lib/api';
import type { CustomFieldDefinition, CustomFieldEntity, CustomFieldType } from '../../lib/api';
import { TYPE_LABELS, renderTypedInput, parseDefaultForDisplay, serializeDefaultValue } from '../../lib/customFieldRendering';
import { NAME_MAX_LENGTH } from '../../lib/validation';

// Campos personalizados (redesenho no kit, etapa 9 do polimento — 02/10/2026). Mudanças aprovadas:
// cadastro em abas; Ativos/Desativados com contagem; sai a coluna Status (repetia o filtro); emojis
// dos tipos viraram ícones do sistema (nomes e exemplos combinados em 17/09 mantidos); renomear e
// remover opção em uso confirmam juntos (antes renomear pulava o aviso de opção em uso).

const ENTITY_TABS: { id: CustomFieldEntity; label: string; icon: LucideIcon }[] = [
  { id: 'client', label: 'Clientes', icon: HeartHandshake },
  { id: 'role', label: 'Cargos', icon: Briefcase },
  { id: 'employee', label: 'Funcionários', icon: Users },
  { id: 'product', label: 'Produtos', icon: Package },
];

const entityLabel = (entity: CustomFieldEntity) => ENTITY_TABS.find((t) => t.id === entity)?.label ?? '';

// Ícone + rótulo + exemplo de cada tipo (rótulos e exemplos combinados com o dono do produto).
const TYPE_PICKER: Record<CustomFieldType, { icon: LucideIcon; label: string; example?: string }> = {
  TEXT: { icon: Type, label: 'Texto curto', example: 'Ex.: código interno, apelido' },
  LONG_TEXT: { icon: AlignLeft, label: 'Texto longo', example: 'Ex.: observações, anotações' },
  NUMBER: { icon: Hash, label: 'Número', example: 'Ex.: quantidade, idade' },
  CURRENCY: { icon: Banknote, label: 'Valor em dinheiro', example: 'Ex.: comissão, valor extra' },
  DATE: { icon: Calendar, label: 'Data', example: 'Ex.: aniversário, vencimento' },
  DATETIME: { icon: CalendarClock, label: 'Data e hora', example: 'Ex.: horário de um evento' },
  BOOLEAN: { icon: ToggleLeft, label: 'Sim ou não', example: 'Ex.: recebe comissão?' },
  SELECT: { icon: List, label: 'Lista de opções', example: 'Ex.: Segmento: Pequeno, Médio, Grande' },
  MULTI_SELECT: { icon: ListChecks, label: 'Lista de opções (múltipla escolha)', example: 'Ex.: Interesses: Financeiro, RH, Vendas' },
  EMAIL: { icon: Mail, label: 'E-mail' },
  PHONE: { icon: Phone, label: 'Telefone' },
  CPF: { icon: SquareUser, label: 'CPF', example: 'Ex.: CPF do cliente pessoa física' },
  CNPJ: { icon: Building2, label: 'CNPJ', example: 'Ex.: CNPJ do cliente pessoa jurídica' },
};

const CUSTOM_FIELD_TYPES = Object.keys(TYPE_LABELS) as CustomFieldType[];

const hasOptions = (type: CustomFieldType | null) => type === 'SELECT' || type === 'MULTI_SELECT';

const parseOptions = (text: string): string[] => text.split(',').map((s) => s.trim()).filter(Boolean);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

interface CreateFormState {
  type: CustomFieldType | null;
  displayName: string;
  optionsText: string;
  required: boolean;
  defaultValue: string;
}

const emptyCreateForm: CreateFormState = { type: null, displayName: '', optionsText: '', required: false, defaultValue: '' };

interface EditFormState {
  displayName: string;
  description: string;
  required: boolean;
  optionsText: string;
  displayOrder: number;
  defaultValue: string;
}

type ConfirmAction =
  // Salvar uma edição que renomeia e/ou remove opções em uso (as duas checagens numa confirmação só).
  | { kind: 'save-edit'; field: CustomFieldDefinition; form: EditFormState; newName?: string; removedOptions: { option: string; count: number }[] }
  | { kind: 'deactivate'; field: CustomFieldDefinition }
  | { kind: 'reactivate'; field: CustomFieldDefinition }
  | { kind: 'delete'; field: CustomFieldDefinition; filledCount: number };

/** "Valor padrão" com o widget do próprio tipo e um "Remover" explícito (nem todo widget sabe ficar vazio). */
const DefaultValueField = ({
  type, options, value, onChange, hint,
}: { type: CustomFieldType; options?: string[]; value: string; onChange: (v: string) => void; hint: string }) => (
  <div>
    <div className="mb-1.5 flex items-center justify-between">
      <label id="cf-default-label" htmlFor="cf-default" className="text-[13px] font-medium text-foreground">Valor padrão</label>
      {value && (
        <Button variant="ghost" size="sm" icon={X} onClick={() => onChange('')} className="-mr-2 h-7">Remover</Button>
      )}
    </div>
    {renderTypedInput(
      type,
      options,
      parseDefaultForDisplay({ type, defaultValue: value || null }),
      (v) => onChange(serializeDefaultValue(type, v)),
      { id: 'cf-default', labelId: 'cf-default-label' },
    )}
    <p className="mt-1.5 text-[12px] text-muted">{hint}</p>
  </div>
);

const CustomFieldsSettings = () => {
  // Permissões por ação (27/09/2026): criar/editar/desativar/excluir definições segue
  // `campos-personalizados.gerenciar` do perfil (mesma regra do backend).
  const currentUser = useCurrentUser();
  const canManageFields = can('campos-personalizados.gerenciar', currentUser);

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
  const [isCheckingOptionUsage, setIsCheckingOptionUsage] = useState(false);

  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);
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

  const counts = useMemo(() => ({
    active: definitions.filter((d) => d.active).length,
    inactive: definitions.filter((d) => !d.active).length,
  }), [definitions]);

  const filteredDefinitions = useMemo(() => {
    const wantActive = statusFilter === 'active';
    return definitions.filter((d) => d.active === wantActive).sort((a, b) => a.displayOrder - b.displayOrder);
  }, [definitions, statusFilter]);

  // ---- Criar ----

  const openCreateModal = () => {
    setCreateForm(emptyCreateForm);
    setActionError(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (isSavingCreate) return;
    setIsCreateModalOpen(false);
    setActionError(null);
  };

  const createNameTooLong = createForm.displayName.length > NAME_MAX_LENGTH;
  const isCreateFormValid =
    createForm.type !== null &&
    createForm.displayName.trim() !== '' &&
    !createNameTooLong &&
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
        ...(createForm.defaultValue ? { defaultValue: createForm.defaultValue } : {}),
      });
      setDefinitions((prev) => [...prev, created]);
      toast.success(`Campo criado: ${created.displayName}`);
      setStatusFilter('active');
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
      defaultValue: field.defaultValue ?? '',
    });
    setActionError(null);
  };

  const closeEditModal = () => {
    if (isSavingEdit || isCheckingOptionUsage) return;
    setEditingField(null);
    setEditForm(null);
    setActionError(null);
  };

  const editNameTooLong = !!editForm && editForm.displayName.length > NAME_MAX_LENGTH;
  const isEditFormValid =
    !!editForm &&
    editForm.displayName.trim() !== '' &&
    !editNameTooLong &&
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
        // Sempre enviado: string vazia vira `null` explícito, que o backend aceita para remover o
        // valor padrão (17/09/2026).
        defaultValue: form.defaultValue || null,
      });
      setDefinitions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      toast.success(`Campo atualizado: ${updated.displayName}`);
      setEditingField(null);
      setEditForm(null);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar as alterações deste campo.');
      return false;
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingField || !editForm || isSavingEdit || isCheckingOptionUsage || !isEditFormValid) return;
    const trimmedName = editForm.displayName.trim();
    const renamed = trimmedName !== editingField.displayName;

    // Opções removidas que algum registro usa: sem o aviso, esses registros ficariam com o campo vazio.
    let removedInUse: { option: string; count: number }[] = [];
    if (hasOptions(editingField.type)) {
      const newOptions = parseOptions(editForm.optionsText);
      const removed = (editingField.configuration?.options ?? []).filter((o) => !newOptions.includes(o));
      if (removed.length > 0) {
        setIsCheckingOptionUsage(true);
        setActionError(null);
        try {
          const counted = await Promise.all(
            removed.map(async (option) => ({ option, count: await api.getCustomFieldOptionUsageCount(editingField.id, option) })),
          );
          removedInUse = counted.filter((c) => c.count > 0);
        } catch (err) {
          setActionError(err instanceof Error ? err.message : 'Não foi possível verificar o uso das opções removidas.');
          return;
        } finally {
          setIsCheckingOptionUsage(false);
        }
      }
    }

    if (renamed || removedInUse.length > 0) {
      setConfirmAction({
        kind: 'save-edit',
        field: editingField,
        form: editForm,
        newName: renamed ? trimmedName : undefined,
        removedOptions: removedInUse,
      });
      return;
    }
    performEditSave(editingField, editForm);
  };

  // ---- Desativar / Reativar / Excluir ----

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

  const handleConfirm = async () => {
    if (!confirmAction || isConfirmBusy) return;
    setIsConfirmBusy(true);
    setActionError(null);
    try {
      if (confirmAction.kind === 'save-edit') {
        // Em erro a confirmação fecha e o aviso aparece na janela de edição, que continua aberta.
        await performEditSave(confirmAction.field, confirmAction.form);
      } else if (confirmAction.kind === 'deactivate') {
        const updated = await api.deactivateCustomFieldDefinition(confirmAction.field.id);
        setDefinitions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        toast.success(`Campo desativado: ${updated.displayName}`);
      } else if (confirmAction.kind === 'reactivate') {
        const updated = await api.activateCustomFieldDefinition(confirmAction.field.id);
        setDefinitions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        toast.success(`Campo ativado: ${updated.displayName}`);
      } else {
        const deletedId = confirmAction.field.id;
        await api.deleteCustomFieldDefinition(deletedId);
        toast.success(`Campo excluído: ${confirmAction.field.displayName}`);
        setDefinitions((prev) => prev.filter((d) => d.id !== deletedId));
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível concluir esta ação.');
    } finally {
      setIsConfirmBusy(false);
      setConfirmAction(null);
    }
  };

  const menuItemsFor = (field: CustomFieldDefinition): MenuItem[] => [
    { label: 'Editar', icon: Pencil, onSelect: () => openEditModal(field) },
    field.active
      ? { label: 'Desativar', icon: Ban, onSelect: () => { setActionError(null); setConfirmAction({ kind: 'deactivate', field }); } }
      : { label: 'Reativar', icon: RotateCcw, onSelect: () => { setActionError(null); setConfirmAction({ kind: 'reactivate', field }); } },
    { label: 'Excluir', icon: Trash2, onSelect: () => handleDeleteClick(field), tone: 'danger', separated: true, disabled: countLoadingId === field.id },
  ];

  // ---- Textos da confirmação ----

  const confirmCopy = (() => {
    if (!confirmAction) return null;
    const name = confirmAction.field.displayName;
    switch (confirmAction.kind) {
      case 'save-edit':
        return {
          title: confirmAction.removedOptions.length > 0 ? 'Opção em uso' : 'Renomear campo?',
          confirmLabel: confirmAction.removedOptions.length > 0 ? 'Salvar mesmo assim' : 'Renomear',
          tone: (confirmAction.removedOptions.length > 0 ? 'danger' : 'default') as 'danger' | 'default',
          body: (
            <div className="space-y-3 text-[14px]">
              {confirmAction.newName && (
                <p className="text-muted">O campo vai passar a se chamar “{confirmAction.newName}”. Os dados já preenchidos não mudam.</p>
              )}
              {confirmAction.removedOptions.length > 0 && (
                <Notice tone="danger">
                  <ul className="space-y-1">
                    {confirmAction.removedOptions.map(({ option, count }) => (
                      <li key={option}>
                        {count} {plural(count, 'registro usa', 'registros usam')} a opção “{option}”. Ao remover, o campo {plural(count, 'desse registro fica', 'desses registros fica')} vazio.
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
            </div>
          ),
        };
      case 'deactivate':
        return {
          title: 'Desativar campo?',
          confirmLabel: 'Desativar',
          tone: 'default' as const,
          body: <p className="text-[14px] text-muted">“{name}” deixa de aparecer nos formulários. Os dados já preenchidos continuam guardados e voltam se você reativar o campo.</p>,
        };
      case 'reactivate':
        return {
          title: 'Reativar campo?',
          confirmLabel: 'Reativar',
          tone: 'default' as const,
          body: <p className="text-[14px] text-muted">“{name}” volta a aparecer nos formulários, com os dados que já estavam preenchidos.</p>,
        };
      case 'delete':
        return {
          title: 'Excluir campo?',
          confirmLabel: 'Excluir definitivamente',
          tone: 'danger' as const,
          confirmText: confirmAction.filledCount > 0 ? name : undefined,
          body: confirmAction.filledCount > 0 ? (
            <Notice tone="danger">
              Este campo tem dados preenchidos em {confirmAction.filledCount} {plural(confirmAction.filledCount, 'registro', 'registros')}. Excluir apaga esses dados para sempre.
            </Notice>
          ) : (
            <p className="text-[14px] text-muted">“{name}” será excluído. Isso não pode ser desfeito.</p>
          ),
        };
    }
  })();

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Campos personalizados"
          description="Campos próprios da sua empresa nos cadastros de Clientes, Cargos, Funcionários e Produtos."
          actions={canManageFields ? <Button icon={Plus} onClick={openCreateModal}>Novo campo</Button> : undefined}
        />

        <Tabs<CustomFieldEntity>
          label="Cadastro"
          tabs={ENTITY_TABS}
          value={entity}
          onChange={setEntity}
          className="mb-4"
        />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">Campos do cadastro de {entityLabel(entity)}.</p>
          <SegmentedControl<'active' | 'inactive'>
            label="Filtrar por situação"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'active', label: `Ativos ${counts.active}` },
              { value: 'inactive', label: `Desativados ${counts.inactive}` },
            ]}
          />
        </div>

        {loadError && <Notice tone="danger" className="mb-4">{loadError}</Notice>}
        {!isCreateModalOpen && !editingField && actionError && (
          <Notice tone="danger" className="mb-4" onDismiss={() => setActionError(null)}>{actionError}</Notice>
        )}

        <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border" role="status" aria-label="Carregando campos">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-6 px-5 h-14">
                  <span className="skeleton h-4 w-44" />
                  <span className="skeleton h-4 w-28 hidden sm:block" />
                  <span className="skeleton h-4 w-16 ml-auto" />
                </div>
              ))}
            </div>
          ) : loadError ? null : filteredDefinitions.length > 0 ? (
            <Table>
              <THead>
                <tr>
                  <TH>Campo</TH>
                  <TH className="hidden sm:table-cell">Tipo</TH>
                  <TH className="hidden md:table-cell">Obrigatório</TH>
                  {canManageFields && <TH align="right"><span className="sr-only">Ações</span></TH>}
                </tr>
              </THead>
              <TBody>
                {filteredDefinitions.map((field) => {
                  const type = TYPE_PICKER[field.type];
                  const TypeIcon = type.icon;
                  return (
                    <TR key={field.id} interactive={canManageFields} onClick={() => canManageFields && openEditModal(field)}>
                      <TD>
                        <p className="font-medium text-foreground">{field.displayName}</p>
                        {field.description && <p className="text-[12px] text-muted">{field.description}</p>}
                        <p className="text-[12px] text-muted sm:hidden">{type.label}{field.required ? ' · obrigatório' : ''}</p>
                      </TD>
                      <TD className="hidden sm:table-cell">
                        <span className="inline-flex items-center gap-2 text-muted">
                          <TypeIcon size={15} strokeWidth={1.8} aria-hidden="true" />
                          {type.label}
                        </span>
                      </TD>
                      <TD className="hidden md:table-cell text-muted">{field.required ? 'Sim' : 'Não'}</TD>
                      {canManageFields && (
                        <TD align="right" onClick={(e) => e.stopPropagation()}>
                          <Menu label="Ações" ariaLabel={`Ações do campo ${field.displayName}`} items={menuItemsFor(field)} />
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <EmptyState
              title={statusFilter === 'active' ? 'Nenhum campo ativo' : 'Nenhum campo desativado'}
              description={statusFilter === 'active'
                ? `O cadastro de ${entityLabel(entity)} ainda não tem campos personalizados.`
                : `Nenhum campo do cadastro de ${entityLabel(entity)} está desativado.`}
              action={statusFilter === 'active' && canManageFields ? <Button variant="secondary" icon={Plus} onClick={openCreateModal}>Novo campo</Button> : undefined}
            />
          )}
        </div>
      </div>

      {/* Novo campo */}
      <Modal
        open={isCreateModalOpen}
        onClose={closeCreateModal}
        title={`Novo campo em ${entityLabel(entity)}`}
        description="Só esta empresa vê os campos que você cria."
        size="lg"
        dismissable={!isSavingCreate}
        footer={
          <>
            <Button variant="secondary" onClick={closeCreateModal} disabled={isSavingCreate}>Cancelar</Button>
            <Button type="submit" form="create-field-form" loading={isSavingCreate} disabled={!isCreateFormValid}>Criar campo</Button>
          </>
        }
      >
        {actionError && <Notice tone="danger" className="mb-4">{actionError}</Notice>}
        <form id="create-field-form" onSubmit={handleCreateSubmit} className="space-y-5" noValidate>
          <div role="radiogroup" aria-label="Tipo de campo">
            <p className="mb-2 text-[13px] font-medium text-foreground">Tipo de campo <span className="text-danger">*</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {CUSTOM_FIELD_TYPES.map((type) => {
                const { icon: Icon, label, example } = TYPE_PICKER[type];
                const checked = createForm.type === type;
                return (
                  <label
                    key={type}
                    className={`flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-foreground ${
                      checked ? 'border-primary bg-secondary' : 'border-border hover:bg-secondary/60'
                    }`}
                  >
                    <input
                      type="radio"
                      name="custom-field-type"
                      checked={checked}
                      onChange={() => setCreateForm((prev) => (prev.type === type ? prev : { ...prev, type, defaultValue: '' }))}
                      className="sr-only"
                    />
                    <Icon size={17} strokeWidth={1.8} className="mt-0.5 shrink-0 text-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-foreground leading-tight">{label}</span>
                      {example && <span className="block mt-0.5 text-[12px] text-muted leading-snug">{example}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <Field label="Nome do campo" htmlFor="cf-name" required error={createNameTooLong ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined}>
            <Input
              id="cf-name" value={createForm.displayName} maxLength={NAME_MAX_LENGTH} invalid={createNameTooLong}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, displayName: e.target.value }))}
              placeholder="Ex.: Data de aniversário"
            />
          </Field>

          {hasOptions(createForm.type) && (
            <Field label="Opções" htmlFor="cf-options" required hint="Separe as opções por vírgula.">
              <Input
                id="cf-options" value={createForm.optionsText}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, optionsText: e.target.value }))}
                placeholder="Ex.: Ouro, Prata, Bronze"
              />
            </Field>
          )}

          {createForm.type && (
            <DefaultValueField
              type={createForm.type}
              options={hasOptions(createForm.type) ? parseOptions(createForm.optionsText) : undefined}
              value={createForm.defaultValue}
              onChange={(v) => setCreateForm((prev) => ({ ...prev, defaultValue: v }))}
              hint="Já vem preenchido ao criar um novo registro; quem estiver cadastrando pode mudar."
            />
          )}

          <Switch
            checked={createForm.required}
            onChange={(required) => setCreateForm((prev) => ({ ...prev, required }))}
            label="Obrigatório"
            description="O cadastro só salva com este campo preenchido."
          />
        </form>
      </Modal>

      {/* Editar campo */}
      <Modal
        open={!!editingField && !!editForm}
        onClose={closeEditModal}
        title="Editar campo"
        description={editingField ? `${TYPE_PICKER[editingField.type].label}. O tipo não muda depois de criado.` : undefined}
        size="lg"
        dismissable={!isSavingEdit && !isCheckingOptionUsage}
        footer={
          <>
            <Button variant="secondary" onClick={closeEditModal} disabled={isSavingEdit || isCheckingOptionUsage}>Cancelar</Button>
            <Button type="submit" form="edit-field-form" loading={isSavingEdit || isCheckingOptionUsage} disabled={!isEditFormValid}>
              Salvar alterações
            </Button>
          </>
        }
      >
        {editingField && editForm && (
          <>
            {actionError && <Notice tone="danger" className="mb-4">{actionError}</Notice>}
            <form id="edit-field-form" onSubmit={handleEditSubmit} className="space-y-5" noValidate>
              <Field label="Nome do campo" htmlFor="cf-edit-name" required error={editNameTooLong ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined}>
                <Input
                  id="cf-edit-name" value={editForm.displayName} maxLength={NAME_MAX_LENGTH} invalid={editNameTooLong} data-autofocus
                  onChange={(e) => setEditForm((prev) => prev && { ...prev, displayName: e.target.value })}
                />
              </Field>
              <Field label="Descrição" htmlFor="cf-edit-description" hint="Texto de ajuda que aparece junto ao campo.">
                <Textarea
                  id="cf-edit-description" rows={2} value={editForm.description}
                  onChange={(e) => setEditForm((prev) => prev && { ...prev, description: e.target.value })}
                />
              </Field>
              {hasOptions(editingField.type) && (
                <Field label="Opções" htmlFor="cf-edit-options" required hint="Separe as opções por vírgula.">
                  <Input
                    id="cf-edit-options" value={editForm.optionsText}
                    onChange={(e) => setEditForm((prev) => prev && { ...prev, optionsText: e.target.value })}
                  />
                </Field>
              )}
              <DefaultValueField
                type={editingField.type}
                options={hasOptions(editingField.type) ? parseOptions(editForm.optionsText) : undefined}
                value={editForm.defaultValue}
                onChange={(v) => setEditForm((prev) => prev && { ...prev, defaultValue: v })}
                hint="Vale para registros criados daqui em diante; os que já existem não mudam."
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <Field label="Ordem de exibição" htmlFor="cf-edit-order" hint="Menor aparece primeiro.">
                  <Input
                    id="cf-edit-order" type="number" inputMode="numeric" value={editForm.displayOrder}
                    onChange={(e) => setEditForm((prev) => prev && { ...prev, displayOrder: Number(e.target.value) })}
                  />
                </Field>
                <div className="sm:pt-6">
                  <Switch
                    checked={editForm.required}
                    onChange={(required) => setEditForm((prev) => prev && { ...prev, required })}
                    label="Obrigatório"
                  />
                </div>
              </div>
            </form>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmAction}
        onClose={() => !isConfirmBusy && setConfirmAction(null)}
        onConfirm={handleConfirm}
        title={confirmCopy?.title ?? ''}
        confirmLabel={confirmCopy?.confirmLabel ?? 'Confirmar'}
        tone={confirmCopy?.tone}
        confirmText={confirmCopy && 'confirmText' in confirmCopy ? confirmCopy.confirmText : undefined}
        busy={isConfirmBusy}
      >
        {confirmCopy?.body}
      </ConfirmDialog>
    </div>
  );
};

export default CustomFieldsSettings;
