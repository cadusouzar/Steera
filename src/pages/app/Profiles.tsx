import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Lock, Pencil, Plus, Shield, Trash2, X } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import * as api from '../../lib/api';
import type { PermissionCatalogEntry, Profile, ProfileGrant } from '../../lib/api';
import { buildPermissionGroups, type PermissionGroup, type PermissionRow } from '../../lib/permissionGroups';

const SCOPE_OPTIONS = [
  { value: 'PROPRIO', label: 'Só eu' },
  { value: 'EQUIPE', label: 'Minha equipe' },
  { value: 'DEPARTAMENTO', label: 'Meu departamento' },
  { value: 'EMPRESA', label: 'Empresa toda' },
];

function scopeOptionsFor(codes: string[]) {
  return codes.map((code) => SCOPE_OPTIONS.find((o) => o.value === code)).filter((o): o is (typeof SCOPE_OPTIONS)[number] => !!o);
}

type LevelValue = 'none' | 'ver' | 'gerenciar';

interface GrantFormState {
  permissionCode: string;
  enabled: boolean;
  scope: string | null;
}

function buildInitialGrants(catalog: PermissionCatalogEntry[], existing: ProfileGrant[]): GrantFormState[] {
  return catalog.map((entry) => {
    const current = existing.find((g) => g.permissionCode === entry.code);
    return {
      permissionCode: entry.code,
      enabled: !!current,
      scope: current?.scope ?? (entry.validScopes[0] ?? null),
    };
  });
}

function computeInitialExpanded(groups: PermissionGroup[], grants: GrantFormState[]): Record<string, boolean> {
  const byCode = new Map(grants.map((g) => [g.permissionCode, g]));
  const result: Record<string, boolean> = {};
  for (const group of groups) {
    result[group.key] = group.rows.some((row) =>
      row.kind === 'toggle' ? !!byCode.get(row.code)?.enabled : !!byCode.get(row.verCode)?.enabled || !!byCode.get(row.manageCode)?.enabled,
    );
  }
  return result;
}

const LEVEL_LABELS: Record<LevelValue, string> = { none: 'Sem acesso', ver: 'Ver', gerenciar: 'Gerenciar' };

interface PermissionRowViewProps {
  row: PermissionRow;
  catalogByCode: Map<string, PermissionCatalogEntry>;
  grantsByCode: Map<string, GrantFormState>;
  getLevel: (verCode: string, manageCode: string) => LevelValue;
  levelScopeCodes: (verCode: string, manageCode: string, level: LevelValue) => string[];
  toggleGrant: (code: string) => void;
  setGrantScope: (code: string, scope: string) => void;
  setLevel: (verCode: string, manageCode: string, level: LevelValue) => void;
  setLevelScope: (verCode: string, manageCode: string, level: LevelValue, scope: string) => void;
}

// Uma linha do editor de permissões agrupado — checkbox simples para ações únicas, ou um segmented
// control "Sem acesso | Ver | Gerenciar" para recursos com os dois códigos. Puramente de
// apresentação: o formato de `ProfileGrant` salvo continua idêntico ao da lista plana de toggles
// anterior.
function PermissionRowView({
  row,
  catalogByCode,
  grantsByCode,
  getLevel,
  levelScopeCodes,
  toggleGrant,
  setGrantScope,
  setLevel,
  setLevelScope,
}: PermissionRowViewProps) {
  if (row.kind === 'toggle') {
    const entry = catalogByCode.get(row.code);
    const grant = grantsByCode.get(row.code);
    const enabled = !!grant?.enabled;
    const scopeCodes = entry?.validScopes ?? [];
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
        <label className="flex items-center gap-3 flex-1 min-w-[180px] cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={() => toggleGrant(row.code)}
            className="w-4 h-4 rounded accent-primary shrink-0"
          />
          <span className="text-sm text-foreground">{row.label}</span>
        </label>
        {enabled && scopeCodes.length > 0 && (
          <div className="w-full sm:w-44 shrink-0">
            <CustomSelect value={grant?.scope ?? scopeCodes[0]} onChange={(val) => setGrantScope(row.code, val)} options={scopeOptionsFor(scopeCodes)} />
          </div>
        )}
      </div>
    );
  }

  const level = getLevel(row.verCode, row.manageCode);
  const scopeCodes = levelScopeCodes(row.verCode, row.manageCode, level);
  const currentGrant = level === 'gerenciar' ? grantsByCode.get(row.manageCode) : grantsByCode.get(row.verCode);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-foreground flex-1 min-w-[180px]">{row.label}</span>
      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
        <div role="radiogroup" aria-label={`Nível de acesso: ${row.label}`} className="inline-flex rounded-lg border border-border overflow-hidden shrink-0">
          {(['none', 'ver', 'gerenciar'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              role="radio"
              aria-checked={level === lvl}
              onClick={() => setLevel(row.verCode, row.manageCode, lvl)}
              className={`px-2.5 py-1.5 text-xs font-bold transition-colors ${lvl !== 'none' ? 'border-l border-border' : ''} ${
                level === lvl ? 'bg-primary text-white' : 'bg-secondary/20 text-foreground hover:bg-secondary/40'
              }`}
            >
              {LEVEL_LABELS[lvl]}
            </button>
          ))}
        </div>
        {level !== 'none' && scopeCodes.length > 0 && (
          <div className="w-44 shrink-0">
            <CustomSelect
              value={currentGrant?.scope ?? scopeCodes[0]}
              onChange={(val) => setLevelScope(row.verCode, row.manageCode, level, val)}
              options={scopeOptionsFor(scopeCodes)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const Profiles: React.FC = () => {
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingProfile, setEditingProfile] = useState<Profile | 'new' | null>(null);
  const [formName, setFormName] = useState('');
  const [formGrants, setFormGrants] = useState<GrantFormState[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const groups = useMemo(() => buildPermissionGroups(catalog), [catalog]);
  const catalogByCode = useMemo(() => new Map(catalog.map((e) => [e.code, e])), [catalog]);
  const grantsByCode = useMemo(() => new Map(formGrants.map((g) => [g.permissionCode, g])), [formGrants]);

  const [deletingProfile, setDeletingProfile] = useState<Profile | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadAll = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [catalogRes, profilesRes] = await Promise.all([api.getPermissionCatalog(), api.listProfiles()]);
      setCatalog(catalogRes);
      setProfiles(profilesRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar perfis');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const openCreate = () => {
    const grants = buildInitialGrants(catalog, []);
    setFormName('');
    setFormGrants(grants);
    setExpandedGroups(computeInitialExpanded(groups, grants));
    setFormError(null);
    setEditingProfile('new');
  };

  const openEdit = (profile: Profile) => {
    const grants = buildInitialGrants(catalog, profile.grants);
    setFormName(profile.name);
    setFormGrants(grants);
    setExpandedGroups(computeInitialExpanded(groups, grants));
    setFormError(null);
    setEditingProfile(profile);
  };

  const closeForm = () => setEditingProfile(null);

  const toggleGrant = (code: string) => {
    setFormGrants((prev) => prev.map((g) => (g.permissionCode === code ? { ...g, enabled: !g.enabled } : g)));
  };

  const setGrantScope = (code: string, scope: string) => {
    setFormGrants((prev) => prev.map((g) => (g.permissionCode === code ? { ...g, scope } : g)));
  };

  const getLevel = (verCode: string, manageCode: string): LevelValue => {
    const manageGrant = grantsByCode.get(manageCode);
    const verGrant = grantsByCode.get(verCode);
    if (manageGrant?.enabled) return 'gerenciar';
    if (verGrant?.enabled) return 'ver';
    return 'none';
  };

  const levelScopeCodes = (verCode: string, manageCode: string, level: LevelValue): string[] => {
    const verScopes = catalogByCode.get(verCode)?.validScopes ?? [];
    const manageScopes = catalogByCode.get(manageCode)?.validScopes ?? [];
    if (level === 'ver') return verScopes;
    if (level === 'gerenciar') return manageScopes.filter((s) => verScopes.includes(s));
    return [];
  };

  const setLevel = (verCode: string, manageCode: string, newLevel: LevelValue) => {
    setFormGrants((prev) => {
      const verEntry = catalogByCode.get(verCode);
      const manageEntry = catalogByCode.get(manageCode);
      const verGrant = prev.find((g) => g.permissionCode === verCode);
      const manageGrant = prev.find((g) => g.permissionCode === manageCode);

      if (newLevel === 'none') {
        return prev.map((g) => (g.permissionCode === verCode || g.permissionCode === manageCode ? { ...g, enabled: false } : g));
      }
      if (newLevel === 'ver') {
        const scope = verGrant?.scope ?? verEntry?.validScopes[0] ?? null;
        return prev.map((g) => {
          if (g.permissionCode === verCode) return { ...g, enabled: true, scope };
          if (g.permissionCode === manageCode) return { ...g, enabled: false };
          return g;
        });
      }
      // 'gerenciar' concede os dois códigos (ver + gerenciar) com o mesmo escopo — mesmo shape de
      // grants que marcar os dois toggles manualmente na UI antiga.
      const verScopes = verEntry?.validScopes ?? [];
      const manageScopes = manageEntry?.validScopes ?? [];
      const intersection = manageScopes.filter((s) => verScopes.includes(s));
      const scope = manageGrant?.scope ?? intersection[0] ?? null;
      return prev.map((g) => {
        if (g.permissionCode === verCode || g.permissionCode === manageCode) return { ...g, enabled: true, scope };
        return g;
      });
    });
  };

  const setLevelScope = (verCode: string, manageCode: string, level: LevelValue, scope: string) => {
    setFormGrants((prev) =>
      prev.map((g) => {
        if (level === 'ver' && g.permissionCode === verCode) return { ...g, scope };
        if (level === 'gerenciar' && (g.permissionCode === verCode || g.permissionCode === manageCode)) return { ...g, scope };
        return g;
      }),
    );
  };

  const toggleGroup = (key: string) => setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const expandAllGroups = () => setExpandedGroups(Object.fromEntries(groups.map((g) => [g.key, true])));
  const collapseAllGroups = () => setExpandedGroups(Object.fromEntries(groups.map((g) => [g.key, false])));

  const countEnabledInGroup = (group: PermissionGroup): number =>
    group.rows.reduce((count, row) => {
      if (row.kind === 'toggle') return count + (grantsByCode.get(row.code)?.enabled ? 1 : 0);
      return count + (getLevel(row.verCode, row.manageCode) !== 'none' ? 1 : 0);
    }, 0);

  const hasViewWithoutManage = useMemo(() => {
    // Aviso da "limitação temporária conhecida" (ver spec): sob o ModulesGuard, marcar só "ver"
    // já libera "gerenciar" do mesmo módulo até a Fase 2b trocar a trava.
    return formGrants.some((g) => {
      if (!g.enabled || !g.permissionCode.endsWith('.ver')) return false;
      const manageCode = g.permissionCode.replace('.ver', '.gerenciar');
      return formGrants.some((other) => other.permissionCode === manageCode && !other.enabled);
    });
  }, [formGrants]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFormError(null);
    try {
      const grants: ProfileGrant[] = formGrants
        .filter((g) => g.enabled)
        .map((g) => ({ permissionCode: g.permissionCode, scope: (g.scope as ProfileGrant['scope']) ?? null }));
      if (editingProfile === 'new') {
        await api.createProfile({ name: formName, grants });
      } else if (editingProfile) {
        await api.updateProfile(editingProfile.id, { name: formName, grants });
      }
      closeForm();
      await loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar perfil');
    } finally {
      setIsSaving(false);
    }
  };

  const openDelete = (profile: Profile) => {
    setDeletingProfile(profile);
    setReassignTargetId('');
    setDeleteError(null);
  };

  const handleDelete = async () => {
    if (!deletingProfile) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      if (deletingProfile.userCount > 0) {
        if (!reassignTargetId) {
          setDeleteError('Escolha um perfil de destino para os logins deste perfil');
          setIsDeleting(false);
          return;
        }
        await api.reassignAndDeleteProfile(deletingProfile.id, reassignTargetId);
      } else {
        await api.deleteProfile(deletingProfile.id);
      }
      setDeletingProfile(null);
      await loadAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao excluir perfil');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Shield className="text-primary" size={24} /> Perfis de Acesso
          </h1>
          <p className="text-sm text-muted mt-1">
            Cada perfil define o que um login pode fazer. Atribua um perfil a cada login na tela de Usuários.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors text-sm"
        >
          <Plus size={16} /> Novo Perfil
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">{error}</div>
      )}

      <div className="space-y-3">
        {profiles.map((profile) => (
          <div key={profile.id} className="flex items-center justify-between bg-panel border border-border/40 rounded-2xl p-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{profile.name}</span>
                {profile.isProtected && (
                  <span className="flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    <Lock size={11} /> Protegido
                  </span>
                )}
              </div>
              <p className="text-xs text-muted mt-1">
                {profile.userCount} login{profile.userCount !== 1 ? 's' : ''} usando este perfil
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => openEdit(profile)}
                disabled={profile.isProtected}
                title={profile.isProtected ? 'Este perfil é protegido e não pode ser editado' : 'Editar'}
                className="p-2 rounded-xl border border-border text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => openDelete(profile)}
                disabled={profile.isProtected}
                title={profile.isProtected ? 'Este perfil é protegido e não pode ser excluído' : 'Excluir'}
                className="p-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-background border border-border/60 rounded-3xl p-6 md:p-8 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-heading font-bold text-foreground">
                {editingProfile === 'new' ? 'Novo Perfil' : `Editar "${(editingProfile as Profile).name}"`}
              </h2>
              <button onClick={closeForm} className="p-2 text-muted hover:text-foreground bg-secondary/50 rounded-full">
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 dark:text-red-400 text-sm">{formError}</div>
            )}

            <form onSubmit={handleSave} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">Nome do Perfil</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-secondary/30 border border-border/60 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              {hasViewWithoutManage && (
                <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    Enquanto a nova trava de permissões não estiver totalmente ativa, marcar "ver" sem marcar
                    "gerenciar" do mesmo recurso ainda libera as duas ações — é uma limitação temporária, conhecida.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 text-xs font-bold text-primary">
                <button type="button" onClick={expandAllGroups} className="hover:underline">Expandir tudo</button>
                <span className="text-border">|</span>
                <button type="button" onClick={collapseAllGroups} className="hover:underline">Recolher tudo</button>
              </div>

              <div className="space-y-2 max-h-[26rem] overflow-y-auto custom-scrollbar pr-1">
                {groups.map((group) => {
                  const isExpanded = !!expandedGroups[group.key];
                  const enabledCount = countEnabledInGroup(group);
                  return (
                    <div key={group.key} className="border border-border/40 rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        aria-expanded={isExpanded}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-secondary/20 hover:bg-secondary/30 transition-colors text-left"
                      >
                        <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                          {isExpanded ? <ChevronDown size={16} className="text-muted shrink-0" /> : <ChevronRight size={16} className="text-muted shrink-0" />}
                          {group.label}
                        </span>
                        <span className="text-xs font-bold text-muted bg-secondary/50 px-2 py-0.5 rounded-full shrink-0">
                          {enabledCount} de {group.rows.length}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="divide-y divide-border/30 px-3">
                          {group.rows.map((row) => (
                            <PermissionRowView
                              key={row.key}
                              row={row}
                              catalogByCode={catalogByCode}
                              grantsByCode={grantsByCode}
                              getLevel={getLevel}
                              levelScopeCodes={levelScopeCodes}
                              toggleGrant={toggleGrant}
                              setGrantScope={setGrantScope}
                              setLevel={setLevel}
                              setLevelScope={setLevelScope}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 flex gap-3 border-t border-border/40">
                <button type="button" onClick={closeForm} className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving || !formName.trim()}
                  className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2"
                >
                  {isSaving && <Loader2 size={16} className="animate-spin" />}
                  {isSaving ? 'Salvando...' : 'Salvar Perfil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-background border border-border/60 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-lg font-heading font-bold text-foreground mb-3">Excluir "{deletingProfile.name}"</h2>

            {deleteError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 mb-4 text-red-600 dark:text-red-400 text-sm">{deleteError}</div>
            )}

            {deletingProfile.userCount > 0 ? (
              <>
                <p className="text-sm text-muted mb-4">
                  {deletingProfile.userCount} login{deletingProfile.userCount !== 1 ? 's' : ''} usa{deletingProfile.userCount === 1 ? '' : 'm'} este perfil.
                  Escolha para qual perfil eles devem ser movidos antes de excluir:
                </p>
                <CustomSelect
                  value={reassignTargetId}
                  onChange={setReassignTargetId}
                  options={profiles.filter((p) => p.id !== deletingProfile.id).map((p) => ({ value: p.id, label: p.name }))}
                  placeholder="Selecione o perfil de destino..."
                />
              </>
            ) : (
              <p className="text-sm text-muted mb-4">Este perfil não está em uso. A exclusão não pode ser desfeita.</p>
            )}

            <div className="pt-4 flex gap-3">
              <button onClick={() => setDeletingProfile(null)} className="flex-1 py-2.5 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm">
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2"
              >
                {isDeleting && <Loader2 size={16} className="animate-spin" />}
                {isDeleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profiles;
