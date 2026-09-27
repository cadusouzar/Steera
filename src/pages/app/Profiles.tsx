import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Eye, Loader2, Lock, Pencil, Plus, Shield, Trash2, X } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import * as api from '../../lib/api';
import type { PermissionCatalogEntry, Profile } from '../../lib/api';
import {
  ADMINISTRACAO_ITEMS,
  COMERCIAL_ITEMS,
  FUNCIONARIOS_EXTRAS,
  INICIO_ITEMS,
  LEVEL_AREAS,
  PONTO_ADMINISTRAR,
  PONTO_ADMIN_LABEL,
  PONTO_FERIADOS,
  PONTO_REGISTRAR,
  SCOPE_ANSWER_LABEL,
  SCOPE_ORDER,
  buildAreas,
  funcionariosScopeOptions,
  grantsToMap,
  indexCatalog,
  mapToGrants,
  normalizeFuncionariosView,
  outrasItems,
  readFuncionarios,
  readLevel,
  setCodeScope,
  summarizeArea,
  toggleCode,
  writeFuncionarios,
  writeLevel,
  type AreaDef,
  type AreaKey,
  type CatalogIndex,
  type CheckboxItem,
  type FuncionariosView,
  type GrantMap,
  type Level,
  type Scope,
} from '../../lib/profileEditorModel';
import { PROFILE_TEMPLATES, buildTemplateGrants, type ProfileTemplate } from '../../lib/profileTemplates';

// ---------------------------------------------------------------------------------------------
// Peças visuais do editor: cartões grandes de escolha (rádio / caixa de seleção). Usam inputs reais
// (escondidos visualmente) para teclado e leitor de tela funcionarem sem nada extra — setas movem a
// escolha num grupo de rádio, espaço marca/desmarca a caixa.
// ---------------------------------------------------------------------------------------------

interface ChoiceCardProps {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
}

const ChoiceCard = ({ name, checked, onSelect, title, description }: ChoiceCardProps) => (
  <label
    className={`flex items-start gap-3 min-h-[44px] px-3 py-2.5 rounded-xl border cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${
      checked ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-secondary/30'
    }`}
  >
    <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
    <span
      aria-hidden="true"
      className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${checked ? 'border-primary bg-primary' : 'border-border'}`}
    >
      {checked && <Check size={12} strokeWidth={3} className="text-white" />}
    </span>
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-foreground">{title}</span>
      {description && <span className="block text-xs text-muted mt-0.5">{description}</span>}
    </span>
  </label>
);

interface CheckCardProps {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  title: string;
  description?: string;
  disabled?: boolean;
}

const CheckCard = ({ checked, onToggle, title, description, disabled }: CheckCardProps) => (
  <label
    className={`flex items-start gap-3 min-h-[44px] px-3 py-2.5 rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-secondary/30'
    } ${checked ? 'border-primary bg-primary/10' : 'border-border/60'}`}
  >
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="sr-only" />
    <span
      aria-hidden="true"
      className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center ${checked ? 'border-primary bg-primary' : 'border-border'}`}
    >
      {checked && <Check size={12} strokeWidth={3} className="text-white" />}
    </span>
    <span className="min-w-0">
      <span className="block text-sm font-semibold text-foreground">{title}</span>
      {description && <span className="block text-xs text-muted mt-0.5">{description}</span>}
    </span>
  </label>
);

const Question = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div role="radiogroup" aria-label={title} className="space-y-2">
    <p className="text-sm font-bold text-foreground">{title}</p>
    {children}
  </div>
);

const ViewOnlyNotice = () => (
  <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
    <span>Atenção: por enquanto, quem pode consultar esta área também consegue editar. Isso será corrigido em breve.</span>
  </div>
);

// ---------------------------------------------------------------------------------------------
// Painéis "Ajustar" de cada área
// ---------------------------------------------------------------------------------------------

interface PanelProps {
  area: AreaDef;
  grants: GrantMap;
  catalog: CatalogIndex;
  onChange: (next: GrantMap) => void;
}

const CheckboxList = ({ items, grants, catalog, onChange }: { items: CheckboxItem[]; grants: GrantMap; catalog: CatalogIndex; onChange: (next: GrantMap) => void }) => (
  <div className="space-y-2">
    {items
      .filter((item) => catalog.has(item.code))
      .map((item) => (
        <CheckCard
          key={item.code}
          checked={item.code in grants}
          onToggle={(on) => onChange(toggleCode(grants, catalog, item.code, on))}
          title={item.label}
          description={item.hint}
        />
      ))}
  </div>
);

const LevelPanel = ({ area, grants, catalog, onChange }: PanelProps) => {
  const cfg = LEVEL_AREAS[area.key as 'clientes' | 'cargos' | 'financeiro'];
  const level = readLevel(grants, cfg.pair);
  const options: { value: Level; title: string }[] = [
    { value: 'none', title: `Nada — não vê ${cfg.noun}` },
    { value: 'view', title: cfg.viewLabel },
    { value: 'full', title: cfg.fullLabel },
  ];
  return (
    <div className="space-y-3">
      <Question title={`O que pode fazer em ${area.title}?`}>
        {options.map((opt) => (
          <ChoiceCard
            key={opt.value}
            name={`nivel-${area.key}`}
            checked={level === opt.value}
            onSelect={() => onChange(writeLevel(grants, catalog, cfg.pair, opt.value))}
            title={opt.title}
          />
        ))}
      </Question>
      {level === 'view' && <ViewOnlyNotice />}
    </div>
  );
};

const FuncionariosPanel = ({ grants, catalog, onChange }: PanelProps) => {
  // A resposta "De quais funcionários?" é lembrada aqui mesmo quando nada está marcado, pra não
  // sumir ao trocar de nível. Só escreve nos grants quando a pessoa muda alguma coisa.
  const [view, setView] = useState<FuncionariosView>(() => readFuncionarios(grants));

  const apply = (draft: FuncionariosView) => {
    const normalized = normalizeFuncionariosView(catalog, draft);
    setView(normalized);
    onChange(writeFuncionarios(grants, catalog, normalized));
  };

  const scopeOptions = funcionariosScopeOptions(catalog, view);
  const showScope = scopeOptions.length > 0 && (view.level !== 'none' || view.extras.length > 0);
  const extrasBlocked = view.level !== 'none' && view.scope === 'PROPRIO';
  const levels: { value: Level; title: string }[] = [
    { value: 'none', title: 'Nada — não vê funcionários' },
    { value: 'view', title: 'Só consultar' },
    { value: 'full', title: 'Consultar, cadastrar e editar' },
  ];

  return (
    <div className="space-y-4">
      <Question title="O que pode fazer em Funcionários?">
        {levels.map((opt) => (
          <ChoiceCard
            key={opt.value}
            name="nivel-funcionarios"
            checked={view.level === opt.value}
            onSelect={() => apply({ ...view, level: opt.value })}
            title={opt.title}
          />
        ))}
      </Question>
      {view.level === 'view' && <ViewOnlyNotice />}

      {showScope && (
        <Question title="De quais funcionários?">
          {scopeOptions.map((scope) => (
            <ChoiceCard
              key={scope}
              name="escopo-funcionarios"
              checked={view.scope === scope}
              onSelect={() => apply({ ...view, scope })}
              title={SCOPE_ANSWER_LABEL[scope]}
            />
          ))}
        </Question>
      )}

      <div className="space-y-2">
        <p className="text-sm font-bold text-foreground">Também pode:</p>
        {extrasBlocked && <p className="text-xs text-muted">Disponível quando a pessoa cuida da equipe ou mais.</p>}
        {FUNCIONARIOS_EXTRAS.filter((extra) => catalog.has(extra.code)).map((extra) => (
          <CheckCard
            key={extra.code}
            checked={view.extras.includes(extra.code)}
            disabled={extrasBlocked}
            onToggle={(on) =>
              apply({ ...view, extras: on ? [...view.extras, extra.code] : view.extras.filter((c) => c !== extra.code) })
            }
            title={extra.label}
          />
        ))}
      </div>
    </div>
  );
};

const PontoPanel = ({ grants, catalog, onChange }: PanelProps) => {
  const adminEntry = catalog.get(PONTO_ADMINISTRAR);
  const adminScopes = SCOPE_ORDER.filter((s) => adminEntry?.validScopes.includes(s));
  const currentAdmin: Scope | 'none' = PONTO_ADMINISTRAR in grants ? grants[PONTO_ADMINISTRAR] ?? 'none' : 'none';
  return (
    <div className="space-y-4">
      {catalog.has(PONTO_REGISTRAR) && (
        <CheckCard
          checked={PONTO_REGISTRAR in grants}
          onToggle={(on) => onChange(toggleCode(grants, catalog, PONTO_REGISTRAR, on))}
          title="Bater o próprio ponto"
        />
      )}
      {adminEntry && (
        <Question title="Pode administrar o ponto (aprovar ajustes e corrigir marcações)?">
          <ChoiceCard
            name="ponto-admin"
            checked={!(PONTO_ADMINISTRAR in grants)}
            onSelect={() => onChange(setCodeScope(grants, catalog, PONTO_ADMINISTRAR, null))}
            title="Não"
          />
          {adminScopes.map((scope) => (
            <ChoiceCard
              key={scope}
              name="ponto-admin"
              checked={currentAdmin === scope}
              onSelect={() => onChange(setCodeScope(grants, catalog, PONTO_ADMINISTRAR, scope))}
              title={PONTO_ADMIN_LABEL[scope]}
            />
          ))}
        </Question>
      )}
      {catalog.has(PONTO_FERIADOS) && (
        <CheckCard
          checked={PONTO_FERIADOS in grants}
          onToggle={(on) => onChange(toggleCode(grants, catalog, PONTO_FERIADOS, on))}
          title="Cadastrar feriados da empresa"
        />
      )}
    </div>
  );
};

const AreaPanel = (props: PanelProps) => {
  const { area, grants, catalog, onChange } = props;
  switch (area.key) {
    case 'inicio':
      return <CheckboxList items={INICIO_ITEMS} grants={grants} catalog={catalog} onChange={onChange} />;
    case 'clientes':
    case 'cargos':
    case 'financeiro':
      return <LevelPanel {...props} />;
    case 'funcionarios':
      return <FuncionariosPanel {...props} />;
    case 'ponto':
      return <PontoPanel {...props} />;
    case 'comercial':
      return <CheckboxList items={COMERCIAL_ITEMS} grants={grants} catalog={catalog} onChange={onChange} />;
    case 'administracao':
      return <CheckboxList items={ADMINISTRACAO_ITEMS} grants={grants} catalog={catalog} onChange={onChange} />;
    case 'outras':
      return <CheckboxList items={outrasItems(catalog, area)} grants={grants} catalog={catalog} onChange={onChange} />;
  }
};

// ---------------------------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------------------------

type EditorStep = 'template' | 'review';

const Profiles = () => {
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingProfile, setEditingProfile] = useState<Profile | 'new' | null>(null);
  const [step, setStep] = useState<EditorStep>('template');
  const [formName, setFormName] = useState('');
  const [formGrants, setFormGrants] = useState<GrantMap>({});
  const [openArea, setOpenArea] = useState<AreaKey | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const catalogIndex = useMemo(() => indexCatalog(catalog), [catalog]);
  const areas = useMemo(() => buildAreas(catalogIndex), [catalogIndex]);

  const [deletingProfile, setDeletingProfile] = useState<Profile | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isReadOnly = editingProfile !== null && editingProfile !== 'new' && editingProfile.isProtected;

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
    setFormGrants({});
    setOpenArea(null);
    setFormError(null);
    setStep('template');
    setEditingProfile('new');
  };

  const openEdit = (profile: Profile) => {
    setFormName(profile.name);
    setFormGrants(grantsToMap(profile.grants));
    setOpenArea(null);
    setFormError(null);
    setStep('review');
    setEditingProfile(profile);
  };

  const chooseTemplate = (template: ProfileTemplate) => {
    setFormGrants(buildTemplateGrants(template, catalog));
    setFormName(template.key === 'zero' ? '' : template.title);
    setOpenArea(null);
    setStep('review');
  };

  const closeForm = () => setEditingProfile(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || !formName.trim()) return;
    setIsSaving(true);
    setFormError(null);
    try {
      const grants = mapToGrants(formGrants);
      if (editingProfile === 'new') {
        await api.createProfile({ name: formName.trim(), grants });
      } else if (editingProfile) {
        await api.updateProfile(editingProfile.id, { name: formName.trim(), grants });
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

  const modalTitle =
    editingProfile === 'new'
      ? 'Novo perfil'
      : editingProfile
        ? isReadOnly
          ? `Perfil "${editingProfile.name}"`
          : `Editar "${editingProfile.name}"`
        : '';
  const modalSubtitle = step === 'template' ? 'Comece por um modelo' : isReadOnly ? 'O que este perfil pode fazer' : 'Confira e ajuste';

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
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
          <div key={profile.id} className="flex items-center justify-between gap-3 bg-panel border border-border/40 rounded-2xl p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
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
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => openEdit(profile)}
                title={profile.isProtected ? 'Ver o que este perfil pode fazer' : 'Editar'}
                aria-label={profile.isProtected ? `Ver o perfil ${profile.name}` : `Editar o perfil ${profile.name}`}
                className="p-2 rounded-xl border border-border text-foreground hover:bg-secondary transition-colors"
              >
                {profile.isProtected ? <Eye size={16} /> : <Pencil size={16} />}
              </button>
              <button
                onClick={() => openDelete(profile)}
                disabled={profile.isProtected}
                title={profile.isProtected ? 'Este perfil é protegido e não pode ser excluído' : 'Excluir'}
                aria-label={`Excluir o perfil ${profile.name}`}
                className="p-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-sm">
          <form
            onSubmit={handleSave}
            className="bg-background border border-border/60 rounded-3xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            {/* Cabeçalho fixo */}
            <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-border/40 shrink-0">
              <div className="min-w-0">
                <h2 className="text-xl font-heading font-bold text-foreground break-words">{modalTitle}</h2>
                <p className="text-sm text-muted mt-0.5">{modalSubtitle}</p>
              </div>
              <button type="button" onClick={closeForm} aria-label="Fechar" className="p-2 text-muted hover:text-foreground bg-secondary/50 rounded-full shrink-0">
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div className="mx-5 sm:mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-red-600 dark:text-red-400 text-sm shrink-0">
                {formError}
              </div>
            )}

            {/* Único trecho que rola */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 sm:px-6 py-5">
              {step === 'template' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PROFILE_TEMPLATES.map((template) => {
                    const Icon = template.icon;
                    return (
                      <button
                        key={template.key}
                        type="button"
                        onClick={() => chooseTemplate(template)}
                        className="flex items-start gap-3 text-left p-4 min-h-[88px] rounded-2xl border border-border/60 bg-panel hover:border-primary hover:bg-primary/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <span className="w-10 h-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                          <Icon size={20} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-bold text-foreground">{template.title}</span>
                          <span className="block text-sm text-muted mt-0.5">{template.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-5">
                  {editingProfile === 'new' && (
                    <button
                      type="button"
                      onClick={() => setStep('template')}
                      className="flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
                    >
                      <ArrowLeft size={14} /> Trocar modelo
                    </button>
                  )}

                  {isReadOnly && (
                    <div className="flex gap-2 text-sm text-foreground bg-secondary/30 border border-border/60 rounded-xl p-3">
                      <Lock size={16} className="shrink-0 mt-0.5 text-muted" />
                      <span>Este perfil é do sistema e não pode ser alterado.</span>
                    </div>
                  )}

                  <div>
                    <label htmlFor="profile-name" className="block text-sm font-bold text-foreground mb-1.5">Nome do perfil</label>
                    <input
                      id="profile-name"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      readOnly={isReadOnly}
                      required
                      placeholder="Ex.: Recepção"
                      className="w-full px-4 py-3 rounded-xl bg-secondary/30 border border-border/60 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 read-only:opacity-70"
                    />
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-bold text-foreground">O que este perfil pode fazer</p>
                    {areas.map((area) => {
                      const lines = summarizeArea(formGrants, catalogIndex, area);
                      const isOpen = openArea === area.key;
                      const panelId = `area-panel-${area.key}`;
                      return (
                        <div key={area.key} className={`rounded-2xl border ${isOpen ? 'border-primary/60' : 'border-border/50'} bg-panel`}>
                          <div className="flex items-start justify-between gap-3 p-4">
                            <div className="min-w-0">
                              <p className="font-bold text-foreground">{area.title}</p>
                              <ul className="mt-1.5 space-y-1">
                                {lines.map((line, i) => (
                                  <li key={i} className={`flex items-start gap-2 text-sm ${line.ok ? 'text-foreground' : 'text-muted'}`}>
                                    {line.ok ? (
                                      <Check size={16} className="shrink-0 mt-0.5 text-primary" aria-label="Sim" />
                                    ) : (
                                      <X size={16} className="shrink-0 mt-0.5 text-muted" aria-label="Não" />
                                    )}
                                    <span>{line.text}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            {!isReadOnly && (
                              <button
                                type="button"
                                onClick={() => setOpenArea(isOpen ? null : area.key)}
                                aria-expanded={isOpen}
                                aria-controls={panelId}
                                className={`shrink-0 min-h-[40px] px-3 rounded-xl text-sm font-bold border transition-colors ${
                                  isOpen ? 'border-primary bg-primary text-white' : 'border-border text-foreground hover:bg-secondary'
                                }`}
                              >
                                {isOpen ? 'Pronto' : 'Ajustar'}
                              </button>
                            )}
                          </div>
                          {isOpen && !isReadOnly && (
                            <div id={panelId} className="border-t border-border/40 p-4">
                              <AreaPanel area={area} grants={formGrants} catalog={catalogIndex} onChange={setFormGrants} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé fixo */}
            <div className="px-5 sm:px-6 py-4 flex gap-3 border-t border-border/40 shrink-0">
              <button
                type="button"
                onClick={closeForm}
                className="flex-1 py-3 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm"
              >
                {isReadOnly ? 'Fechar' : 'Cancelar'}
              </button>
              {step === 'review' && !isReadOnly && (
                <button
                  type="submit"
                  disabled={isSaving || !formName.trim()}
                  className="flex-1 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2"
                >
                  {isSaving && <Loader2 size={16} className="animate-spin" />}
                  {isSaving ? 'Salvando...' : 'Salvar perfil'}
                </button>
              )}
            </div>
          </form>
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
