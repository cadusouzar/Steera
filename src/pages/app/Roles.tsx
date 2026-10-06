import { useState, useMemo, useEffect, useCallback } from 'react';
import { Ban, ChevronRight, Plus, RotateCcw, Search, X } from 'lucide-react';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';
import RoleColorPicker from '../../components/RoleColorPicker';
import {
  Button, ButtonLink, ConfirmDialog, Drawer, EmptyState, Field, Input, Notice, PageHeader, SegmentedControl,
  StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea, toast,
} from '../../components/ui';
import * as api from '../../lib/api';
import { useCan } from '../../lib/auth';
import type { Role } from '../../lib/api';
import { isValidRoleColor, validateRoleFields, type RoleFieldErrors } from '../../lib/roleFields';
import { NAME_MAX_LENGTH, TEXT_MAX_LENGTH } from '../../lib/validation';

// Cargos (redesenho no kit, etapa 8 do polimento — 02/10/2026). Mudanças aprovadas: uso de cargos
// ativos do plano abaixo do título; filtro Todos/Ativos/Inativos; nome e departamento passam a ser
// editáveis na ficha (antes só descrição, cor e campos personalizados); inativar confirma numa janela.

type StatusFilter = 'all' | 'active' | 'inactive';

const Roles = () => {
  // Sem `cargos.gerenciar`: sem "Novo cargo", e a ficha abre só para consulta.
  const canManageRoles = useCan()('cargos.gerenciar');
  const [roles, setRoles] = useState<Role[]>([]);
  const [plan, setPlan] = useState<api.MyPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Ficha: `draft` é a cópia editável do cargo aberto.
  const [draft, setDraft] = useState<Role | null>(null);
  const [errors, setErrors] = useState<RoleFieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const loadRoles = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [items, myPlan] = await Promise.all([api.listRoles(), api.getMyPlan().catch(() => null)]);
      setRoles(items);
      setPlan(myPlan);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os cargos.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const refreshPlan = () => api.getMyPlan().then(setPlan).catch(() => undefined);

  const counts = useMemo(() => ({
    all: roles.length,
    active: roles.filter((r) => r.active).length,
    inactive: roles.filter((r) => !r.active).length,
  }), [roles]);

  const filteredRoles = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase().trim();
    return roles.filter((role) => {
      if (statusFilter === 'active' && !role.active) return false;
      if (statusFilter === 'inactive' && role.active) return false;
      if (!lowerQuery) return true;
      return role.name.toLowerCase().includes(lowerQuery) || role.department.toLowerCase().includes(lowerQuery);
    });
  }, [roles, searchQuery, statusFilter]);

  const openRole = (role: Role) => {
    setActionError(null);
    setErrors({});
    setDraft({ ...role });
  };

  const closeDrawer = () => {
    if (isSaving) return;
    setDraft(null);
  };

  const handleSave = async () => {
    if (!draft || isSaving) return;
    const nextErrors = validateRoleFields({ name: draft.name, department: draft.department, description: draft.description ?? '' });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !isValidRoleColor(draft.colorHex)) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const saved = await api.updateRole(draft.id, {
        name: draft.name.trim(),
        department: draft.department.trim(),
        colorHex: draft.colorHex.toUpperCase(),
        description: draft.description ?? '',
        customFields: draft.customFields,
      });
      setRoles((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
      setDraft(null);
      toast.success(`Cargo atualizado: ${saved.name}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!draft) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.deactivateRole(draft.id);
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setDraft(null);
      refreshPlan();
      toast.success(`Cargo inativado: ${updated.name}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível inativar o cargo.');
    } finally {
      setIsSaving(false);
      setConfirmDeactivate(false);
    }
  };

  const handleReactivate = async () => {
    if (!draft) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.reactivateRole(draft.id);
      setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setDraft((prev) => (prev ? { ...prev, active: updated.active } : prev));
      refreshPlan();
      toast.success(`Cargo reativado: ${updated.name}`);
    } catch (err) {
      // Ex.: limite de cargos ativos do plano — a mensagem do backend explica.
      setActionError(err instanceof Error ? err.message : 'Não foi possível reativar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  const roleLimit = plan?.current.limits.maxRoles;
  const atLimit = roleLimit != null && plan != null && plan.usage.roles >= roleLimit;
  const planLine = plan && roleLimit != null && (
    <p className="-mt-3 mb-6 text-[13px] text-muted">
      Cargos ativos: <span className="text-foreground tabular">{plan.usage.roles} de {roleLimit}</span> no plano {plan.current.label}
      {atLimit && ' — limite atingido. Inative um cargo para criar outro.'}
    </p>
  );

  const emptyState = roles.length === 0 ? (
    <EmptyState
      title="Nenhum cargo ainda"
      description="Crie os cargos da empresa para usá-los no cadastro de funcionários."
      action={canManageRoles ? <ButtonLink to="/app/cargos/novo" icon={Plus}>Novo cargo</ButtonLink> : undefined}
    />
  ) : (
    <EmptyState
      title="Nenhum cargo encontrado"
      description={searchQuery ? `Nada corresponde a “${searchQuery}” neste filtro.` : 'Nenhum cargo neste filtro.'}
      action={<Button variant="secondary" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>Limpar busca e filtro</Button>}
    />
  );

  const readOnly = !canManageRoles;
  const drawerFooter = !draft ? undefined : readOnly ? (
    <Button variant="secondary" onClick={closeDrawer}>Fechar</Button>
  ) : (
    <>
      {draft.active ? (
        <Button variant="ghost" icon={Ban} onClick={() => setConfirmDeactivate(true)} disabled={isSaving} className="mr-auto">Inativar</Button>
      ) : (
        <Button variant="secondary" icon={RotateCcw} onClick={handleReactivate} loading={isSaving} className="mr-auto">Reativar</Button>
      )}
      <Button variant="secondary" onClick={closeDrawer} disabled={isSaving}>Cancelar</Button>
      <Button onClick={handleSave} loading={isSaving}>Salvar alterações</Button>
    </>
  );

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Cargos"
          description="Os cargos da empresa. Eles aparecem no cadastro de funcionários."
          actions={canManageRoles ? <ButtonLink to="/app/cargos/novo" icon={Plus}>Novo cargo</ButtonLink> : undefined}
        />
        {planLine}

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={16} strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome ou departamento"
              aria-label="Buscar cargos"
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-secondary"
                aria-label="Limpar busca"
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            )}
          </div>
          <SegmentedControl<StatusFilter>
            label="Filtrar por situação"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: `Todos ${counts.all}` },
              { value: 'active', label: `Ativos ${counts.active}` },
              { value: 'inactive', label: `Inativos ${counts.inactive}` },
            ]}
          />
        </div>

        {loadError && <Notice tone="danger" className="mb-4">{loadError}</Notice>}

        <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border" aria-label="Carregando cargos" role="status">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-6 px-5 h-14">
                  <span className="skeleton h-4 w-44" />
                  <span className="skeleton h-4 w-28 hidden sm:block" />
                  <span className="skeleton h-4 w-16 ml-auto" />
                </div>
              ))}
            </div>
          ) : loadError ? null : filteredRoles.length > 0 ? (
            <Table>
              <THead>
                <tr>
                  <TH>Cargo</TH>
                  <TH className="hidden sm:table-cell">Departamento</TH>
                  <TH>Situação</TH>
                  <TH align="right"><span className="sr-only">Abrir</span></TH>
                </tr>
              </THead>
              <TBody>
                {filteredRoles.map((role) => (
                  <TR key={role.id} interactive onClick={() => openRole(role)}>
                    <TD>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: role.colorHex }} aria-hidden="true" />
                        {/* Botão real com o nome: acesso por teclado à ficha (a linha é só atalho de mouse). */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openRole(role); }}
                          className="font-medium text-foreground text-left hover:underline underline-offset-4 outline-none focus-visible:underline truncate"
                        >
                          {role.name}
                        </button>
                      </div>
                      <span className="block pl-5 text-[12px] text-muted sm:hidden">{role.department}</span>
                    </TD>
                    <TD className="hidden sm:table-cell text-muted">{role.department}</TD>
                    <TD>
                      <StatusBadge tone={role.active ? 'success' : 'neutral'}>{role.active ? 'Ativo' : 'Inativo'}</StatusBadge>
                    </TD>
                    <TD align="right" className="w-8">
                      <ChevronRight size={16} strokeWidth={1.6} className="text-muted inline" aria-hidden="true" />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            emptyState
          )}
        </div>
      </div>

      <Drawer
        open={!!draft}
        onClose={closeDrawer}
        title={
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate">{draft ? (roles.find((r) => r.id === draft.id)?.name ?? draft.name) : ''}</span>
            {draft && !draft.active && <StatusBadge tone="neutral">Inativo</StatusBadge>}
          </span>
        }
        description={draft ? (roles.find((r) => r.id === draft.id)?.department ?? draft.department) : undefined}
        size="lg"
        dismissable={!isSaving}
        footer={drawerFooter}
      >
        {draft && (
          <>
            {actionError && <Notice tone="danger" className="mb-5" onDismiss={() => setActionError(null)}>{actionError}</Notice>}
            {readOnly && <Notice className="mb-5">Seu perfil permite só consultar este cargo.</Notice>}
            <fieldset disabled={readOnly} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nome do cargo" htmlFor="role-name" required error={errors.name}>
                  <Input
                    id="role-name" value={draft.name} maxLength={NAME_MAX_LENGTH} invalid={!!errors.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Departamento" htmlFor="role-department" required error={errors.department}>
                  <Input
                    id="role-department" value={draft.department} maxLength={NAME_MAX_LENGTH} invalid={!!errors.department}
                    onChange={(e) => setDraft({ ...draft, department: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Atribuições" htmlFor="role-description" error={errors.description} hint="O que esta pessoa faz no dia a dia.">
                <Textarea
                  id="role-description" rows={5} value={draft.description ?? ''} maxLength={TEXT_MAX_LENGTH} invalid={!!errors.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              <RoleColorPicker value={draft.colorHex} onChange={(hex) => setDraft({ ...draft, colorHex: hex })} disabled={readOnly} />
              <CustomFieldsFormSection
                entity="role"
                values={draft.customFields ?? {}}
                onChange={(v) => setDraft({ ...draft, customFields: v })}
              />
            </fieldset>
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmDeactivate}
        onClose={() => !isSaving && setConfirmDeactivate(false)}
        onConfirm={handleDeactivate}
        title="Inativar este cargo?"
        description={draft ? `“${draft.name}” deixa de aparecer no cadastro de funcionários. Quem já tem esse cargo continua com ele, e dá para reativar depois.` : undefined}
        confirmLabel="Inativar cargo"
        tone="danger"
        busy={isSaving}
      />
    </div>
  );
};

export default Roles;
