import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Lock, Pencil, Plus, Shield, Trash2, X } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import * as api from '../../lib/api';
import type { PermissionCatalogEntry, Profile, ProfileGrant } from '../../lib/api';

const SCOPE_OPTIONS = [
  { value: 'PROPRIO', label: 'Só eu' },
  { value: 'EQUIPE', label: 'Minha equipe' },
  { value: 'DEPARTAMENTO', label: 'Meu departamento' },
  { value: 'EMPRESA', label: 'Empresa toda' },
];

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

const Profiles: React.FC = () => {
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingProfile, setEditingProfile] = useState<Profile | 'new' | null>(null);
  const [formName, setFormName] = useState('');
  const [formGrants, setFormGrants] = useState<GrantFormState[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    setFormName('');
    setFormGrants(buildInitialGrants(catalog, []));
    setFormError(null);
    setEditingProfile('new');
  };

  const openEdit = (profile: Profile) => {
    setFormName(profile.name);
    setFormGrants(buildInitialGrants(catalog, profile.grants));
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

              <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-1">
                {catalog.map((entry) => {
                  const grant = formGrants.find((g) => g.permissionCode === entry.code)!;
                  return (
                    <div key={entry.code} className="flex items-center justify-between gap-3 border border-border/40 rounded-xl p-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleGrant(entry.code)}
                          className={`w-10 h-6 rounded-full shrink-0 transition-colors relative ${grant.enabled ? 'bg-primary' : 'bg-secondary border border-border'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${grant.enabled ? 'translate-x-4' : ''}`} />
                        </button>
                        <span className="text-sm text-foreground truncate">{entry.labelPt}</span>
                      </div>
                      {grant.enabled && entry.validScopes.length > 0 && (
                        <div className="w-44 shrink-0">
                          <CustomSelect
                            value={grant.scope ?? entry.validScopes[0]}
                            onChange={(val) => setGrantScope(entry.code, val)}
                            options={entry.validScopes.map((s) => SCOPE_OPTIONS.find((o) => o.value === s)!)}
                          />
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
