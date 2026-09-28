import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronRight, Eye, Loader2, Lock, Pencil, Plus, Shield, Trash2, X } from 'lucide-react';
import CustomSelect from '../../components/CustomSelect';
import * as api from '../../lib/api';
import type { PermissionCatalogEntry, Profile } from '../../lib/api';
import {
  ADMINISTRACAO_ITEMS,
  COMERCIAL_ITEMS,
  FUNCIONARIOS_EXTRAS,
  INICIO_ITEMS,
  LEVEL_AREAS,
  OWN_DATA_CODE,
  PONTO_ADMINISTRAR,
  PONTO_ADMIN_LABEL,
  PONTO_FERIADOS,
  PONTO_REGISTRAR,
  SCOPE_ANSWER_LABEL,
  SCOPE_ORDER,
  areaStatus,
  buildAreas,
  funcionariosScopeOptions,
  grantsToMap,
  indexCatalog,
  mapToGrants,
  normalizeFuncionariosView,
  outrasItems,
  ownDataQuestionVisible,
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
import { useCurrentUser } from '../../lib/auth';
import {
  NOT_IN_YOUR_PROFILE_HINT,
  PROFILE_ABOVE_CALLER_MESSAGE,
  callerGrantsOf,
  isWithinCaller,
  type CallerGrants,
} from '../../lib/grantCoverage';

// ---------------------------------------------------------------------------------------------
// Peças visuais do editor: linhas grandes de escolha (rádio / caixa de seleção). Usam inputs reais
// (escondidos visualmente) para teclado e leitor de tela funcionarem sem nada extra: setas movem a
// escolha num grupo de rádio, espaço marca/desmarca a caixa.
// ---------------------------------------------------------------------------------------------

const optionRowClass = (checked: boolean, disabled = false) =>
  `flex items-start gap-3 min-h-[44px] px-3.5 py-3 rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
  } ${checked ? 'border-primary bg-primary/5' : `border-border/40 ${disabled ? '' : 'hover:bg-secondary/40'}`}`;

const OptionText = ({ title, description, hint, hintId }: { title: string; description?: string; hint?: string; hintId?: string }) => (
  <span className="min-w-0">
    <span className="block text-sm font-medium text-foreground">{title}</span>
    {description && <span className="block text-sm text-muted mt-0.5">{description}</span>}
    {hint && <span id={hintId} className="block text-xs text-muted mt-0.5">{hint}</span>}
  </span>
);

// `blockedHint` (concessão limitada, 28/09/2026): a opção daria uma permissão ou alcance que o perfil
// de quem está editando não tem. Fica desabilitada, com o motivo escrito embaixo do título e ligado ao
// campo por `aria-describedby`. Uma opção já marcada nunca é bloqueada (desmarcar sempre pode).

interface ChoiceRowProps {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  blockedHint?: string;
}

const ChoiceRow = ({ name, checked, onSelect, title, description, blockedHint }: ChoiceRowProps) => {
  const hintId = useId();
  const blocked = !!blockedHint && !checked;
  return (
    <label className={optionRowClass(checked, blocked)} title={blocked ? blockedHint : undefined}>
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={blocked}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? hintId : undefined}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${checked ? 'border-primary bg-primary' : 'border-border'}`}
      >
        {checked && <Check size={12} strokeWidth={3} className="text-white" />}
      </span>
      <OptionText title={title} description={description} hint={blocked ? blockedHint : undefined} hintId={hintId} />
    </label>
  );
};

interface CheckRowProps {
  checked: boolean;
  onToggle: (checked: boolean) => void;
  title: string;
  description?: string;
  disabled?: boolean;
  blockedHint?: string;
}

const CheckRow = ({ checked, onToggle, title, description, disabled, blockedHint }: CheckRowProps) => {
  const hintId = useId();
  const blocked = !!blockedHint && !checked;
  const isDisabled = !!disabled || blocked;
  return (
    <label className={optionRowClass(checked, isDisabled)} title={blocked ? blockedHint : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-describedby={blocked ? hintId : undefined}
        onChange={(e) => onToggle(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center ${checked ? 'border-primary bg-primary' : 'border-border'}`}
      >
        {checked && <Check size={12} strokeWidth={3} className="text-white" />}
      </span>
      <OptionText title={title} description={description} hint={blocked ? blockedHint : undefined} hintId={hintId} />
    </label>
  );
};

/** Motivo para bloquear uma opção cujo resultado sairia do poder de quem edita (ou nada). */
const blockedHintFor = (caller: CallerGrants, next: GrantMap): string | undefined =>
  isWithinCaller(caller, next) ? undefined : NOT_IN_YOUR_PROFILE_HINT;

/** Uma pergunta: título + (ajuda) + opções agrupadas. `kind` decide o papel do grupo para leitor de tela. */
const Question = ({ title, helper, kind = 'radiogroup', children }: { title: string; helper?: string; kind?: 'radiogroup' | 'group'; children: React.ReactNode }) => {
  const titleId = useId();
  return (
    <div role={kind} aria-labelledby={titleId}>
      <p id={titleId} className="text-base font-semibold text-foreground">{title}</p>
      {helper && <p className="text-sm text-muted mt-0.5">{helper}</p>}
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
// Perguntas de cada área (painel da direita)
// ---------------------------------------------------------------------------------------------

interface PanelProps {
  area: AreaDef;
  grants: GrantMap;
  catalog: CatalogIndex;
  onChange: (next: GrantMap) => void;
  /** Permissões de quem está editando: nada acima delas pode ser marcado. */
  caller: CallerGrants;
}

const CheckboxList = ({ items, grants, catalog, onChange, caller }: { items: CheckboxItem[]; grants: GrantMap; catalog: CatalogIndex; onChange: (next: GrantMap) => void; caller: CallerGrants }) => (
  <div className="space-y-2">
    {items
      .filter((item) => catalog.has(item.code))
      .map((item) => (
        <CheckRow
          key={item.code}
          checked={item.code in grants}
          onToggle={(on) => onChange(toggleCode(grants, catalog, item.code, on))}
          title={item.label}
          description={item.hint}
          blockedHint={blockedHintFor(caller, toggleCode(grants, catalog, item.code, true))}
        />
      ))}
  </div>
);

const LevelPanel = ({ area, grants, catalog, onChange, caller }: PanelProps) => {
  const cfg = LEVEL_AREAS[area.key as 'clientes' | 'cargos' | 'financeiro'];
  const level = readLevel(grants, cfg.pair);
  const options: { value: Level; title: string }[] = [
    { value: 'none', title: cfg.noAccessLabel },
    { value: 'view', title: cfg.viewLabel },
    { value: 'full', title: cfg.fullLabel },
  ];
  return (
    <div className="space-y-4">
      <Question title={`O que esta pessoa pode fazer em ${area.title}?`}>
        {options.map((opt) => (
          <ChoiceRow
            key={opt.value}
            name={`nivel-${area.key}`}
            checked={level === opt.value}
            onSelect={() => onChange(writeLevel(grants, catalog, cfg.pair, opt.value))}
            title={opt.title}
            blockedHint={blockedHintFor(caller, writeLevel(grants, catalog, cfg.pair, opt.value))}
          />
        ))}
      </Question>
    </div>
  );
};

const FuncionariosPanel = ({ grants, catalog, onChange, caller }: PanelProps) => {
  // A resposta "De quais funcionários ela cuida?" é lembrada aqui mesmo quando nada está marcado,
  // pra não sumir ao trocar de nível. Só escreve nos grants quando a pessoa muda alguma coisa.
  const [view, setView] = useState<FuncionariosView>(() => readFuncionarios(grants));

  const apply = (draft: FuncionariosView) => {
    const normalized = normalizeFuncionariosView(catalog, draft);
    const next = writeFuncionarios(grants, catalog, normalized);
    // "Pode alterar os próprios dados?" some (e volta pra "Não") quando o perfil deixa de poder
    // alterar funcionários, pagamentos e férias.
    setView({ ...normalized, ownData: OWN_DATA_CODE in next });
    onChange(next);
  };

  const isCovered = (draft: FuncionariosView) =>
    isWithinCaller(caller, writeFuncionarios(grants, catalog, normalizeFuncionariosView(catalog, draft)));

  // Pra um nível, tenta primeiro o alcance atual e depois os outros (do mais amplo ao mais restrito):
  // o nível só fica bloqueado se nenhum alcance couber no perfil de quem edita.
  const coveredDraftForLevel = (level: Level): FuncionariosView | null => {
    const draft = { ...view, level };
    if (isCovered(draft)) return draft;
    for (const scope of [...funcionariosScopeOptions(catalog, draft)].reverse()) {
      const candidate = { ...draft, scope };
      if (isCovered(candidate)) return candidate;
    }
    return null;
  };
  const hintUnless = (ok: boolean) => (ok ? undefined : NOT_IN_YOUR_PROFILE_HINT);

  const scopeOptions = funcionariosScopeOptions(catalog, view);
  const showScope = scopeOptions.length > 0 && (view.level !== 'none' || view.extras.length > 0);
  const extrasBlocked = view.level !== 'none' && view.scope === 'PROPRIO';
  const extras = FUNCIONARIOS_EXTRAS.filter((extra) => catalog.has(extra.code));
  const levels: { value: Level; title: string }[] = [
    { value: 'none', title: 'Não acessa Funcionários' },
    { value: 'view', title: 'Pode ver, mas não alterar' },
    { value: 'full', title: 'Pode ver, cadastrar e alterar' },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Question title="O que esta pessoa pode fazer em Funcionários?">
          {levels.map((opt) => {
            const target = coveredDraftForLevel(opt.value);
            return (
              <ChoiceRow
                key={opt.value}
                name="nivel-funcionarios"
                checked={view.level === opt.value}
                onSelect={() => target && apply(target)}
                title={opt.title}
                blockedHint={hintUnless(!!target)}
              />
            );
          })}
        </Question>
      </div>

      {showScope && (
        <Question title="De quais funcionários ela cuida?">
          {scopeOptions.map((scope) => (
            <ChoiceRow
              key={scope}
              name="escopo-funcionarios"
              checked={view.scope === scope}
              onSelect={() => apply({ ...view, scope })}
              title={SCOPE_ANSWER_LABEL[scope]}
              blockedHint={hintUnless(isCovered({ ...view, scope }))}
            />
          ))}
        </Question>
      )}

      {extras.length > 0 && (
        <Question kind="group" title="Outras tarefas com funcionários" helper={extrasBlocked ? 'Libere a equipe ou mais pessoas na pergunta acima para usar estas opções.' : undefined}>
          {extras.map((extra) => (
            <CheckRow
              key={extra.code}
              checked={view.extras.includes(extra.code)}
              disabled={extrasBlocked}
              onToggle={(on) =>
                apply({ ...view, extras: on ? [...view.extras, extra.code] : view.extras.filter((c) => c !== extra.code) })
              }
              title={extra.label}
              blockedHint={hintUnless(isCovered({ ...view, extras: [...view.extras, extra.code] }))}
            />
          ))}
        </Question>
      )}

      {catalog.has(OWN_DATA_CODE) && ownDataQuestionVisible(grants) && (
        <Question title="Pode alterar os próprios dados?" helper="(salário, pagamentos, férias, advertências)">
          <ChoiceRow name="proprios-dados" checked={!view.ownData} onSelect={() => apply({ ...view, ownData: false })} title="Não" />
          <ChoiceRow
            name="proprios-dados"
            checked={view.ownData}
            onSelect={() => apply({ ...view, ownData: true })}
            title="Sim"
            blockedHint={hintUnless(isCovered({ ...view, ownData: true }))}
          />
        </Question>
      )}
    </div>
  );
};

const PontoPanel = ({ grants, catalog, onChange, caller }: PanelProps) => {
  const adminEntry = catalog.get(PONTO_ADMINISTRAR);
  const adminScopes = SCOPE_ORDER.filter((s) => adminEntry?.validScopes.includes(s));
  const currentAdmin: Scope | 'none' = PONTO_ADMINISTRAR in grants ? grants[PONTO_ADMINISTRAR] ?? 'none' : 'none';
  return (
    <div className="space-y-6">
      {catalog.has(PONTO_REGISTRAR) && (
        <CheckRow
          checked={PONTO_REGISTRAR in grants}
          onToggle={(on) => onChange(toggleCode(grants, catalog, PONTO_REGISTRAR, on))}
          title="Bater o próprio ponto"
          blockedHint={blockedHintFor(caller, toggleCode(grants, catalog, PONTO_REGISTRAR, true))}
        />
      )}
      {adminEntry && (
        <Question title="Pode cuidar do ponto de outras pessoas?" helper="Aprovar pedidos de ajuste e corrigir horários.">
          <ChoiceRow
            name="ponto-admin"
            checked={!(PONTO_ADMINISTRAR in grants)}
            onSelect={() => onChange(setCodeScope(grants, catalog, PONTO_ADMINISTRAR, null))}
            title="Não"
          />
          {adminScopes.map((scope) => (
            <ChoiceRow
              key={scope}
              name="ponto-admin"
              checked={currentAdmin === scope}
              onSelect={() => onChange(setCodeScope(grants, catalog, PONTO_ADMINISTRAR, scope))}
              title={PONTO_ADMIN_LABEL[scope]}
              blockedHint={blockedHintFor(caller, setCodeScope(grants, catalog, PONTO_ADMINISTRAR, scope))}
            />
          ))}
        </Question>
      )}
      {catalog.has(PONTO_FERIADOS) && (
        <CheckRow
          checked={PONTO_FERIADOS in grants}
          onToggle={(on) => onChange(toggleCode(grants, catalog, PONTO_FERIADOS, on))}
          title="Cadastrar os feriados da empresa"
          blockedHint={blockedHintFor(caller, toggleCode(grants, catalog, PONTO_FERIADOS, true))}
        />
      )}
    </div>
  );
};

const AreaPanel = (props: PanelProps) => {
  const { area, grants, catalog, onChange, caller } = props;
  switch (area.key) {
    case 'inicio':
      return <CheckboxList items={INICIO_ITEMS} grants={grants} catalog={catalog} onChange={onChange} caller={caller} />;
    case 'clientes':
    case 'cargos':
    case 'financeiro':
      return <LevelPanel {...props} />;
    case 'funcionarios':
      return <FuncionariosPanel {...props} />;
    case 'ponto':
      return <PontoPanel {...props} />;
    case 'comercial':
      return <CheckboxList items={COMERCIAL_ITEMS} grants={grants} catalog={catalog} onChange={onChange} caller={caller} />;
    case 'administracao':
      return <CheckboxList items={ADMINISTRACAO_ITEMS} grants={grants} catalog={catalog} onChange={onChange} caller={caller} />;
    case 'outras':
      return <CheckboxList items={outrasItems(catalog, area)} grants={grants} catalog={catalog} onChange={onChange} caller={caller} />;
  }
};

/** Resumo em frases (✓/✗) de uma área, usado no perfil do sistema, que só pode ser visto. */
const AreaSummary = ({ area, grants, catalog }: { area: AreaDef; grants: GrantMap; catalog: CatalogIndex }) => (
  <ul className="space-y-3">
    {summarizeArea(grants, catalog, area).map((line, i) => (
      <li key={i} className={`flex items-start gap-2.5 text-base ${line.ok ? 'text-foreground' : 'text-muted'}`}>
        {line.ok ? (
          <Check size={18} className="shrink-0 mt-0.5 text-primary" aria-label="Sim" />
        ) : (
          <X size={18} className="shrink-0 mt-0.5 text-muted" aria-label="Não" />
        )}
        <span>{line.text}</span>
      </li>
    ))}
  </ul>
);

const usageText = (count: number) =>
  count === 0 ? 'Ninguém usa este perfil ainda' : count === 1 ? 'Usado por 1 pessoa' : `Usado por ${count} pessoas`;

// ---------------------------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------------------------

type EditorStep = 'template' | 'review';

const Profiles = () => {
  // Concessão limitada (28/09/2026): quem edita perfis só concede o que o próprio perfil também tem.
  const currentUser = useCurrentUser();
  const caller = useMemo(() => callerGrantsOf(currentUser), [currentUser]);
  const isAboveCaller = (profile: Profile) => !isWithinCaller(caller, profile.grants);

  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingProfile, setEditingProfile] = useState<Profile | 'new' | null>(null);
  const [step, setStep] = useState<EditorStep>('template');
  const [formName, setFormName] = useState('');
  const [formGrants, setFormGrants] = useState<GrantMap>({});
  const [selectedArea, setSelectedArea] = useState<AreaKey | null>(null);
  // Em telas pequenas mostra uma coisa por vez: a lista de áreas ou as perguntas da área escolhida.
  const [showAreaOnMobile, setShowAreaOnMobile] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const areaButtonRefs = useRef(new Map<AreaKey, HTMLButtonElement>());

  const catalogIndex = useMemo(() => indexCatalog(catalog), [catalog]);
  const areas = useMemo(() => buildAreas(catalogIndex), [catalogIndex]);
  const currentArea = areas.find((a) => a.key === selectedArea) ?? areas[0] ?? null;

  const [deletingProfile, setDeletingProfile] = useState<Profile | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Somente leitura: perfil do sistema, ou perfil com permissões que o perfil de quem edita não tem
  // (o backend recusaria salvar ou excluir com 403).
  const editingAboveCaller =
    editingProfile !== null && editingProfile !== 'new' && !editingProfile.isProtected && isAboveCaller(editingProfile);
  const isReadOnly = editingProfile !== null && editingProfile !== 'new' && (editingProfile.isProtected || editingAboveCaller);

  const loadAll = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [catalogRes, profilesRes] = await Promise.all([api.getPermissionCatalog(), api.listProfiles()]);
      setCatalog(catalogRes);
      setProfiles(profilesRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os perfis.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const resetEditorView = () => {
    setSelectedArea(areas[0]?.key ?? null);
    setShowAreaOnMobile(false);
    setNameMissing(false);
    setFormError(null);
  };

  const openCreate = () => {
    setFormName('');
    setFormGrants({});
    resetEditorView();
    setStep('template');
    setEditingProfile('new');
  };

  const openEdit = (profile: Profile) => {
    setFormName(profile.name);
    setFormGrants(grantsToMap(profile.grants));
    resetEditorView();
    setStep('review');
    setEditingProfile(profile);
  };

  const chooseTemplate = (template: ProfileTemplate) => {
    if (!isWithinCaller(caller, buildTemplateGrants(template, catalog))) return;
    setFormGrants(buildTemplateGrants(template, catalog));
    setFormName(template.key === 'zero' ? '' : template.title);
    resetEditorView();
    setStep('review');
  };

  const closeForm = () => setEditingProfile(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (!formName.trim()) {
      setNameMissing(true);
      nameInputRef.current?.focus();
      return;
    }
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
      setFormError(err instanceof Error ? err.message : 'Não foi possível salvar o perfil.');
    } finally {
      setIsSaving(false);
    }
  };

  const pickArea = (key: AreaKey) => {
    setSelectedArea(key);
    setShowAreaOnMobile(true);
  };

  // Setas para cima/baixo (e Home/End) mudam a área escolhida, como numa lista de abas vertical.
  const handleAreaKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowDown') nextIndex = (index + 1) % areas.length;
    else if (e.key === 'ArrowUp') nextIndex = (index - 1 + areas.length) % areas.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = areas.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const key = areas[nextIndex].key;
    setSelectedArea(key);
    areaButtonRefs.current.get(key)?.focus();
  };

  const openDelete = (profile: Profile) => {
    if (profile.isProtected || isAboveCaller(profile)) return;
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
          setDeleteError('Escolha o novo perfil das pessoas antes de excluir.');
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
      setDeleteError(err instanceof Error ? err.message : 'Não foi possível excluir o perfil.');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin text-primary" size={32} /></div>;
  }

  const modalTitle =
    editingProfile === 'new'
      ? 'Novo perfil de acesso'
      : editingProfile
        ? isReadOnly
          ? `Perfil "${editingProfile.name}"`
          : `Editar o perfil "${editingProfile.name}"`
        : '';

  const renderSubtitle = () => {
    if (step === 'template') return 'Escolha o modelo mais parecido com a função da pessoa. Depois você pode mudar o que quiser.';
    if (isReadOnly) return 'O que este perfil libera.';
    return (
      <>
        <span className="hidden md:inline">Escolha uma área à esquerda e marque o que a pessoa pode fazer.</span>
        <span className="md:hidden">Toque numa área para ver as opções.</span>
      </>
    );
  };

  const deleteCount = deletingProfile?.userCount ?? 0;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Shield className="text-primary" size={24} /> Perfis de Acesso
          </h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            Um perfil diz o que a pessoa pode fazer no sistema. Você escolhe o perfil de cada pessoa na tela Usuários e Acessos.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={16} /> Novo perfil
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">{error}</div>
      )}

      <div className="space-y-3">
        {profiles.map((profile) => {
          const aboveCaller = !profile.isProtected && isAboveCaller(profile);
          const viewOnly = profile.isProtected || aboveCaller;
          return (
          <div key={profile.id} className="flex items-center justify-between gap-3 bg-panel border border-border/40 rounded-2xl p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-foreground">{profile.name}</span>
                {profile.isProtected && (
                  <span
                    title="Perfil criado pelo sistema. Não pode ser alterado nem excluído."
                    className="flex items-center gap-1 text-xs font-semibold text-muted bg-secondary/60 px-2 py-0.5 rounded-full"
                  >
                    <Lock size={11} /> Do sistema
                  </span>
                )}
              </div>
              <p className="text-sm text-muted mt-1">{usageText(profile.userCount)}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => openEdit(profile)}
                title={profile.isProtected ? 'Ver o que este perfil libera' : aboveCaller ? PROFILE_ABOVE_CALLER_MESSAGE : 'Editar'}
                aria-label={viewOnly ? `Ver o perfil ${profile.name}` : `Editar o perfil ${profile.name}`}
                className="p-2 rounded-xl border border-border text-foreground hover:bg-secondary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {viewOnly ? <Eye size={16} /> : <Pencil size={16} />}
              </button>
              <button
                onClick={() => openDelete(profile)}
                disabled={viewOnly}
                aria-disabled={viewOnly || undefined}
                title={
                  profile.isProtected
                    ? 'Perfil criado pelo sistema. Não pode ser alterado nem excluído.'
                    : aboveCaller
                      ? PROFILE_ABOVE_CALLER_MESSAGE
                      : 'Excluir'
                }
                aria-label={`Excluir o perfil ${profile.name}`}
                className="p-2 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {editingProfile && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center md:p-4 bg-background/80 backdrop-blur-sm">
          <form
            onSubmit={handleSave}
            noValidate
            aria-labelledby="profile-modal-title"
            className="bg-background border border-border/60 rounded-t-3xl md:rounded-3xl w-full max-w-5xl shadow-2xl h-[92vh] max-h-[92vh] md:h-[min(90vh,760px)] flex flex-col overflow-hidden"
          >
            {/* Cabeçalho fixo */}
            <div className="flex items-start justify-between gap-3 px-5 md:px-7 pt-5 pb-4 border-b border-border/40 shrink-0">
              <div className="min-w-0">
                <h2 id="profile-modal-title" className="text-xl font-heading font-bold text-foreground break-words">{modalTitle}</h2>
                <p className="text-sm text-muted mt-0.5">{renderSubtitle()}</p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                aria-label="Fechar"
                className="p-2 text-muted hover:text-foreground bg-secondary/50 rounded-full shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div role="alert" className="mx-5 md:mx-7 mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-red-600 dark:text-red-400 text-sm shrink-0">
                {formError}
              </div>
            )}

            {step === 'template' ? (
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 md:px-7 py-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {PROFILE_TEMPLATES.map((template) => {
                    const Icon = template.icon;
                    // Modelo com alguma permissão que o perfil de quem edita não tem: não pode ser usado.
                    const blocked = !isWithinCaller(caller, buildTemplateGrants(template, catalog));
                    const hintId = `template-hint-${template.key}`;
                    return (
                      <button
                        key={template.key}
                        type="button"
                        onClick={() => chooseTemplate(template)}
                        disabled={blocked}
                        aria-disabled={blocked || undefined}
                        aria-describedby={blocked ? hintId : undefined}
                        title={blocked ? NOT_IN_YOUR_PROFILE_HINT : undefined}
                        className={`flex items-start gap-3 text-left p-4 min-h-[96px] rounded-2xl border border-border/60 bg-panel transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                          blocked ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary hover:bg-primary/5'
                        }`}
                      >
                        <span className="w-10 h-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                          <Icon size={20} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-bold text-foreground">{template.title}</span>
                          <span className="block text-sm text-muted mt-0.5">{template.description}</span>
                          {blocked && <span id={hintId} className="block text-xs text-muted mt-1">{NOT_IN_YOUR_PROFILE_HINT}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <>
                {/* Faixa de cima, fora das áreas que rolam */}
                <div className="px-5 md:px-7 py-4 border-b border-border/40 shrink-0">
                  {isReadOnly ? (
                    <div className="flex gap-2 text-sm text-foreground">
                      <Lock size={16} className="shrink-0 mt-0.5 text-muted" />
                      <span>
                        {editingAboveCaller
                          ? PROFILE_ABOVE_CALLER_MESSAGE
                          : 'Este é o perfil do dono da empresa. Ele sempre pode tudo e não pode ser alterado.'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row md:items-end gap-3 md:gap-6">
                      <div className="w-full md:max-w-sm">
                        <label htmlFor="profile-name" className="block text-sm font-semibold text-foreground mb-1.5">Nome do perfil</label>
                        <input
                          id="profile-name"
                          ref={nameInputRef}
                          value={formName}
                          onChange={(e) => {
                            setFormName(e.target.value);
                            if (nameMissing) setNameMissing(false);
                          }}
                          placeholder="Ex.: Recepção"
                          aria-invalid={nameMissing}
                          aria-describedby={nameMissing ? 'profile-name-hint' : undefined}
                          className={`w-full px-4 py-2.5 rounded-xl bg-secondary/30 border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                            nameMissing ? 'border-red-500/60' : 'border-border/60'
                          }`}
                        />
                        {nameMissing && (
                          <p id="profile-name-hint" className="text-sm text-red-600 dark:text-red-400 mt-1.5">
                            Dê um nome ao perfil, por exemplo "Recepção".
                          </p>
                        )}
                      </div>
                      {editingProfile === 'new' && (
                        <button
                          type="button"
                          onClick={() => setStep('template')}
                          className="self-start md:self-auto md:mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          <ArrowLeft size={14} /> Escolher outro modelo
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Duas colunas: áreas à esquerda, perguntas da área à direita. Cada uma rola sozinha. */}
                <div className="flex-1 min-h-0 flex">
                  <div
                    role="tablist"
                    aria-orientation="vertical"
                    aria-label="Áreas do sistema"
                    className={`${showAreaOnMobile ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-72 shrink-0 overflow-y-auto custom-scrollbar p-3 md:border-r border-border/40`}
                  >
                    {areas.map((area, index) => {
                      const isSelected = currentArea?.key === area.key;
                      return (
                        <button
                          key={area.key}
                          ref={(el) => {
                            if (el) areaButtonRefs.current.set(area.key, el);
                            else areaButtonRefs.current.delete(area.key);
                          }}
                          type="button"
                          role="tab"
                          id={`area-tab-${area.key}`}
                          aria-selected={isSelected}
                          aria-controls="area-panel"
                          tabIndex={isSelected ? 0 : -1}
                          onClick={() => pickArea(area.key)}
                          onKeyDown={(e) => handleAreaKeyDown(e, index)}
                          className={`relative flex items-center gap-2 w-full text-left pl-4 pr-3 py-3 min-h-[56px] rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                            isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary/40'
                          }`}
                        >
                          {isSelected && <span aria-hidden="true" className="absolute left-1 top-3 bottom-3 w-1 rounded-full bg-primary" />}
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">{area.title}</span>
                            <span className="block text-sm text-muted mt-0.5">{areaStatus(formGrants, catalogIndex, area)}</span>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" className="md:hidden shrink-0 text-muted" />
                        </button>
                      );
                    })}
                  </div>

                  <div
                    role="tabpanel"
                    id="area-panel"
                    aria-labelledby={currentArea ? `area-tab-${currentArea.key}` : undefined}
                    className={`${showAreaOnMobile ? 'block' : 'hidden'} md:block flex-1 min-w-0 overflow-y-auto custom-scrollbar px-5 md:px-8 py-5 md:py-6`}
                  >
                    <button
                      type="button"
                      onClick={() => setShowAreaOnMobile(false)}
                      className="md:hidden flex items-center gap-1.5 mb-4 text-sm font-semibold text-primary rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <ArrowLeft size={14} /> Voltar para as áreas
                    </button>
                    {currentArea && (
                      <div className="max-w-2xl">
                        <h3 className="text-lg font-heading font-bold text-foreground mb-5">{currentArea.title}</h3>
                        {isReadOnly ? (
                          <AreaSummary area={currentArea} grants={formGrants} catalog={catalogIndex} />
                        ) : (
                          <AreaPanel key={currentArea.key} area={currentArea} grants={formGrants} catalog={catalogIndex} onChange={setFormGrants} caller={caller} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Rodapé fixo */}
            <div className="px-5 md:px-7 py-4 flex justify-end gap-3 border-t border-border/40 shrink-0">
              <button
                type="button"
                onClick={closeForm}
                className="flex-1 md:flex-none md:min-w-[140px] py-3 px-5 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {isReadOnly ? 'Fechar' : 'Cancelar'}
              </button>
              {step === 'review' && !isReadOnly && (
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 md:flex-none md:min-w-[160px] py-3 px-5 rounded-xl font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {isSaving && <Loader2 size={16} className="animate-spin" />}
                  {isSaving ? 'Salvando…' : 'Salvar perfil'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {deletingProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-profile-title" className="bg-background border border-border/60 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <h2 id="delete-profile-title" className="text-lg font-heading font-bold text-foreground mb-3">
              Excluir o perfil "{deletingProfile.name}"?
            </h2>

            {deleteError && (
              <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 mb-4 text-red-600 dark:text-red-400 text-sm">{deleteError}</div>
            )}

            {deleteCount > 0 ? (
              <>
                <p className="text-sm text-muted mb-4">
                  {deleteCount === 1
                    ? '1 pessoa usa este perfil. Escolha o novo perfil dela antes de excluir.'
                    : `${deleteCount} pessoas usam este perfil. Escolha o novo perfil delas antes de excluir.`}
                </p>
                <CustomSelect
                  value={reassignTargetId}
                  onChange={setReassignTargetId}
                  options={profiles
                    // O perfil de destino também precisa caber no perfil de quem exclui (é uma atribuição).
                    .filter((p) => p.id !== deletingProfile.id && !isAboveCaller(p))
                    .map((p) => ({ value: p.id, label: p.name }))}
                  placeholder="Escolha o novo perfil"
                />
              </>
            ) : (
              <p className="text-sm text-muted mb-4">Ninguém usa este perfil, então ele pode ser excluído agora. Isso não pode ser desfeito.</p>
            )}

            <div className="pt-4 flex gap-3">
              <button
                onClick={() => setDeletingProfile(null)}
                className="flex-1 py-2.5 rounded-xl font-bold border border-border text-foreground hover:bg-secondary transition-colors text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl font-bold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
              >
                {isDeleting && <Loader2 size={16} className="animate-spin" />}
                {isDeleting ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profiles;
