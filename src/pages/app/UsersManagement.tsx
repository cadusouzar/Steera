import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Check, Copy, KeyRound, Link2, Lock, Pencil, Search, Send, ShieldCheck, ShieldOff, Trash2, UserPlus, X } from 'lucide-react';
import {
  Button, ConfirmDialog, EmptyState, Field, Input, Menu, Modal, Notice, PageHeader, SegmentedControl, Select,
  StatusBadge, Table, TBody, TD, TH, THead, TR, toast, type MenuItem, type StatusTone,
} from '../../components/ui';
import { can, useCurrentUser } from '../../lib/auth';
import * as api from '../../lib/api';
import type { SystemUser, EmployeeListItem } from '../../lib/api';
import { isValidEmail } from '../../lib/validation';
import {
  LINK_REQUIRES_FULL_SCOPE_HINT,
  LOGIN_ABOVE_CALLER_MESSAGE,
  callerGrantsOf,
  isWithinCaller,
} from '../../lib/grantCoverage';

// Usuários e acessos (redesenho no kit, etapa 6 do polimento — 01/10/2026). Mudanças aprovadas:
// uso de logins do plano abaixo do título; filtro por situação; a coluna "Módulos" virou "Perfil"
// (o nome do perfil e os módulos resumidos numa linha); a janela "Módulos autorizados" saiu — a lista
// completa aparece em "Trocar perfil"; o menu "Ações" ganhou teclado (peça `Menu` do kit). O status
// legado `locked` (convertido em ACTIVE desde 26/09/2026) é exibido como "Bloqueado".

const ROLE_OPTIONS = [
  { value: 'admin' as const, label: 'Administrador' },
  { value: 'employee' as const, label: 'Funcionário' },
];

// Ids iguais ao enum `AppModule` do backend.
const MODULE_LABELS: Record<string, string> = {
  DASHBOARD: 'Visão Geral',
  CLIENTES: 'Clientes',
  COMERCIAL: 'Comercial',
  OPERACOES: 'Operações',
  FINANCAS: 'Finanças',
  RH_CARGOS: 'Cargos',
  RH_FUNCIONARIOS: 'Funcionários',
  PONTO_REGISTRO: 'Bater o próprio ponto',
  PONTO_ADMINISTRACAO: 'Administração do ponto',
};
const moduleLabel = (id: string) => MODULE_LABELS[id] ?? id;
const MAX_INLINE_MODULES = 2;

type StatusFilter = 'all' | 'active' | 'invited' | 'blocked';

const isBlockedStatus = (status: SystemUser['status']) => status === 'blocked' || status === 'locked';
const statusGroup = (status: SystemUser['status']): Exclude<StatusFilter, 'all'> =>
  isBlockedStatus(status) ? 'blocked' : status;

const STATUS_BADGE: Record<Exclude<StatusFilter, 'all'>, { label: string; tone: StatusTone }> = {
  active: { label: 'Ativo', tone: 'success' },
  invited: { label: 'Convite pendente', tone: 'neutral' },
  blocked: { label: 'Bloqueado', tone: 'danger' },
};

interface UserFormState {
  email: string;
  role: 'admin' | 'employee';
  employeeId: string;
  profileId: string;
}

const emptyForm: UserFormState = { email: '', role: 'admin', employeeId: '', profileId: '' };

// Aviso de convite/redefinição de senha ("Acesso e sessões", 26/09/2026) — 'invite' cobre tanto a
// criação de um login quanto "Reenviar convite" (mesma resposta de backend, `inviteUrl`/`sent`);
// 'reset' cobre "Enviar redefinição de senha" pra um login que já aceitou o convite (sem link pra
// copiar — só confirma que o e-mail foi enviado).
type UserNotice =
  | { kind: 'invite'; email: string; inviteUrl: string | null; sent: boolean }
  | { kind: 'reset'; email: string; sent: boolean };

const UsersManagement = () => {
  // Permissões por ação (27/09/2026): gerenciar logins segue a permissão `usuarios.gerenciar` do
  // perfil, não mais o papel ADMIN. O papel do CHAMADOR só importa pro que o backend reserva a
  // administradores: criar outro login ADMIN, atribuir um perfil protegido (Administrador Geral) e
  // reemitir o convite pendente de um ADMIN; essas opções somem pra quem não é ADMIN.
  const currentUser = useCurrentUser();
  const canManageUsers = can('usuarios.gerenciar', currentUser);
  const callerIsAdmin = currentUser?.role === 'admin';
  // Vincular logins a fichas (e criar login de funcionário, que nasce vinculado) exige que todo
  // alcance do perfil de quem está na tela seja EMPRESA: o backend recusa com 403 caso contrário.
  const canLinkEmployees = currentUser?.canSelfLinkEmployee !== false;
  const roleOptions = ROLE_OPTIONS.filter((o) => (o.value === 'admin' ? callerIsAdmin : canLinkEmployees));
  const canCreateLogins = roleOptions.length > 0;
  const newUserForm: UserFormState = { ...emptyForm, role: callerIsAdmin ? 'admin' : 'employee' };
  // Concessão limitada (28/09/2026): só perfis que cabem no perfil de quem está na tela são
  // oferecidos, e logins com um perfil acima dele ficam sem ações (o backend recusaria com 403).
  const callerGrants = useMemo(() => callerGrantsOf(currentUser), [currentUser]);

  const [users, setUsers] = useState<SystemUser[]>([]);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  // Funcionários ativos sem login (id + nome), vindos de `GET /companies/me/users/linkable-employees`:
  // depende só de `usuarios.gerenciar`, não do alcance em Funcionários de quem está na tela.
  const [linkableEmployees, setLinkableEmployees] = useState<api.LinkableEmployee[]>([]);
  const [profiles, setProfiles] = useState<api.Profile[]>([]);
  const [plan, setPlan] = useState<api.MyPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<UserFormState>(emptyForm);
  const [emailError, setEmailError] = useState<string>();

  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // Troca de perfil de um login já existente (17/09/2026, adaptado pra Perfis em 19/09/2026).
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null);
  const [editProfileId, setEditProfileId] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Exclusão de verdade (17/09/2026) — sempre confirmada, nunca window.confirm().
  const [deletingUser, setDeletingUser] = useState<SystemUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Vincular um login ainda sem ficha de funcionário (27/09/2026; desde 28/09/2026 só quem tem todos
  // os alcances em EMPRESA: a ação some pra quem tem `canSelfLinkEmployee === false`).
  const [linkingUser, setLinkingUser] = useState<SystemUser | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  // Envio de redefinição de senha por quem administra (confirmado antes de enviar).
  const [resettingPasswordUser, setResettingPasswordUser] = useState<SystemUser | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Substitui o antigo banner de senha temporária — fecha só com ação explícita (nunca Esc/fundo).
  const [userNotice, setUserNotice] = useState<UserNotice | null>(null);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // `GET /profiles` e `GET /companies/me/users` exigem `usuarios.gerenciar`; sem ela, a
      // listagem de logins recusa com 403 e a mensagem do backend aparece no aviso de erro.
      // `GET /employees` exige `funcionarios.ver` (e vem filtrada pelo alcance): sem ela a tela
      // continua funcionando, só sem os nomes dos funcionários vinculados. Os seletores de
      // funcionário (novo login, vincular) usam `linkable-employees`, que não depende desse alcance.
      const [systemUsers, employeeItems, profileItems, linkableItems, myPlan] = await Promise.all([
        api.listSystemUsers(),
        api.listEmployees().catch(() => [] as EmployeeListItem[]),
        canManageUsers ? api.listProfiles() : Promise.resolve([] as api.Profile[]),
        // Ruling R-final (29/09/2026): `linkable-employees` recusa (403) quem não pode vincular.
        canManageUsers && canLinkEmployees
          ? api.listLinkableEmployees().catch(() => [] as api.LinkableEmployee[])
          : Promise.resolve([] as api.LinkableEmployee[]),
        // Só para a linha "Logins de funcionário: X de Y" — sem o plano, a linha some.
        api.getMyPlan().catch(() => null),
      ]);
      setUsers(systemUsers);
      setEmployees(employeeItems);
      setProfiles(profileItems);
      setLinkableEmployees(linkableItems);
      setPlan(myPlan);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os usuários.');
    } finally {
      setIsLoading(false);
    }
  }, [canManageUsers, canLinkEmployees]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Nome por id: a lista de funcionários (filtrada pelo alcance de quem vê) mais os sem login, pra
  // um vínculo feito nesta tela já mostrar o nome mesmo sem `funcionarios.ver`.
  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    linkableEmployees.forEach(e => map.set(e.id, e.fullName));
    employees.forEach(e => map.set(e.id, e.fullName));
    return map;
  }, [employees, linkableEmployees]);

  const profileNameById = useMemo(() => new Map(profiles.map((p) => [p.id, p.name])), [profiles]);

  // Perfis que cabem no perfil de quem está na tela: os únicos oferecidos nos seletores.
  const coveredProfileIds = useMemo(
    () => new Set(profiles.filter((p) => isWithinCaller(callerGrants, p.grants)).map((p) => p.id)),
    [profiles, callerGrants],
  );
  // Login sem perfil (ou com um perfil fora da lista) conta como "dentro": o backend decide.
  const canActOnUser = (user: SystemUser) => {
    if (!user.profileId) return true;
    const profile = profiles.find((p) => p.id === user.profileId);
    return !profile || coveredProfileIds.has(profile.id);
  };

  // Funcionários que ainda não têm login vinculado. Filtro de UX: o backend já rejeita com 400 um
  // segundo login pro mesmo funcionário, isso só evita a pessoa escolher e bater no erro.
  const linkedEmployeeIds = useMemo(
    () => new Set(users.filter(u => u.employeeId).map(u => u.employeeId as string)),
    [users],
  );
  const availableEmployees = useMemo(
    () => linkableEmployees.filter(e => !linkedEmployeeIds.has(e.id)),
    [linkableEmployees, linkedEmployeeIds],
  );

  const counts = useMemo(() => {
    const c = { all: users.length, active: 0, invited: 0, blocked: 0 };
    users.forEach((u) => { c[statusGroup(u.status)] += 1; });
    return c;
  }, [users]);

  const filteredUsers = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase().trim();
    return users.filter(u => {
      if (statusFilter !== 'all' && statusGroup(u.status) !== statusFilter) return false;
      if (!lowerQuery) return true;
      const employeeName = u.employeeId ? employeeNameById.get(u.employeeId) ?? '' : '';
      const roleLabel = u.role === 'admin' ? 'administrador' : 'funcionário';
      const profileName = u.profileId ? profileNameById.get(u.profileId) ?? '' : '';
      return (
        u.email.toLowerCase().includes(lowerQuery) ||
        employeeName.toLowerCase().includes(lowerQuery) ||
        profileName.toLowerCase().includes(lowerQuery) ||
        roleLabel.includes(lowerQuery)
      );
    });
  }, [users, searchQuery, statusFilter, employeeNameById, profileNameById]);

  const openNewModal = () => {
    setFormData(newUserForm);
    setActionError(null);
    setEmailError(undefined);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setActionError(null);
  };

  const isFormValid =
    formData.email.trim() !== '' &&
    isValidEmail(formData.email) &&
    (formData.role === 'admin' || formData.employeeId !== '') &&
    formData.profileId !== '';

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!isFormValid) {
      if (formData.email && !isValidEmail(formData.email)) setEmailError('E-mail inválido');
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      // O backend é a autoridade: limite de logins do plano e funcionário já vinculado são checados
      // lá, com dados em tempo real.
      const result = await api.createSystemUser({
        email: formData.email.trim(),
        role: formData.role,
        employeeId: formData.role === 'employee' ? formData.employeeId : undefined,
        profileId: formData.profileId,
      });
      setUsers(prev => [...prev, result.user]);
      setUserNotice({ kind: 'invite', email: result.user.email, inviteUrl: result.inviteUrl, sent: result.sent });
      toast.success(result.sent ? `Convite enviado: ${result.user.email}` : `Acesso criado: ${result.user.email}`);
      setIsModalOpen(false);
      setFormData(newUserForm);
      // O uso do plano mudou (convite pendente já ocupa vaga).
      api.getMyPlan().then(setPlan).catch(() => undefined);
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
      if (isBlockedStatus(user.status)) {
        await api.unblockSystemUser(user.id);
        toast.success(`Acesso desbloqueado: ${user.email}`);
      } else {
        await api.blockSystemUser(user.id);
        toast.success(`Acesso bloqueado: ${user.email}`);
      }
      // Recarrega em vez de adivinhar o novo status: desbloquear um login que nunca aceitou o
      // convite volta pra `invited` (não `active`) — ver UsersService.unblock().
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível atualizar o status deste usuário.');
    } finally {
      setPendingUserId(null);
    }
  };

  // Reenvia o convite de um login ainda `invited` (a ação só aparece pra esse status).
  const handleResendInvite = async (user: SystemUser) => {
    if (pendingUserId) return;
    setPendingUserId(user.id);
    setActionError(null);
    try {
      const result = await api.resendSystemUserInvite(user.id);
      if (result.sent) toast.success(`Convite reenviado: ${user.email}`);
      setUserNotice({ kind: 'invite', email: user.email, inviteUrl: result.inviteUrl, sent: result.sent });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível reenviar o convite deste usuário.');
    } finally {
      setPendingUserId(null);
    }
  };

  const closeUserNotice = () => {
    setUserNotice(null);
    setCopied(false);
  };

  const handleCopyInviteLink = async () => {
    if (!userNotice || userNotice.kind !== 'invite' || !userNotice.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(userNotice.inviteUrl);
      setCopied(true);
    } catch {
      // Sem acesso à área de transferência — o link continua visível para copiar à mão.
    }
  };

  const openEditModal = (user: SystemUser) => {
    setEditingUser(user);
    setEditProfileId(user.profileId ?? '');
    setActionError(null);
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setActionError(null);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    // `!editProfileId` (revisão final da branch, 22/09/2026): um login sem perfil (FK `onDelete:
    // SetNull`) abria com o seletor vazio e deixava submeter — o backend respondia com um erro confuso.
    if (!editingUser || isSavingEdit || !editProfileId) return;
    setIsSavingEdit(true);
    setActionError(null);
    try {
      await api.assignUserProfile(editingUser.id, editProfileId);
      toast.success(`Perfil alterado: ${editingUser.email}`);
      await loadData();
      closeEditModal();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível atualizar o perfil deste usuário.');
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
      toast.success(`Acesso excluído: ${deletingUser.email}`);
      setUsers(prev => prev.filter(u => u.id !== deletingUser.id));
      api.getMyPlan().then(setPlan).catch(() => undefined);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível excluir este login.');
    } finally {
      setDeletingUser(null);
      setIsDeleting(false);
    }
  };

  const openLinkModal = (user: SystemUser) => {
    setLinkingUser(user);
    setLinkEmployeeId('');
    setActionError(null);
  };

  const closeLinkModal = () => {
    setLinkingUser(null);
    setActionError(null);
  };

  const handleConfirmLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkingUser || !linkEmployeeId || isLinking) return;
    setIsLinking(true);
    setActionError(null);
    try {
      await api.linkUserToEmployee(linkingUser.id, linkEmployeeId);
      toast.success(`Ficha vinculada: ${linkingUser.email}`);
      setLinkingUser(null);
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível vincular este login ao funcionário.');
    } finally {
      setIsLinking(false);
    }
  };

  const handleConfirmResetPassword = async () => {
    if (!resettingPasswordUser || isResettingPassword) return;
    setIsResettingPassword(true);
    setActionError(null);
    try {
      const result = await api.resetSystemUserPassword(resettingPasswordUser.id);
      const email = resettingPasswordUser.email;
      if (result.sent) toast.success(result.inviteUrl !== undefined ? `Convite reenviado: ${email}` : `Link de redefinição enviado: ${email}`);
      // Um login ainda `invited` não tem senha pra redefinir — o backend reenvia o convite em vez
      // disso (`inviteUrl` presente, possivelmente `null` para quem não pode vincular fichas).
      if (result.inviteUrl !== undefined) {
        setUserNotice({ kind: 'invite', email, inviteUrl: result.inviteUrl, sent: result.sent });
      } else {
        setUserNotice({ kind: 'reset', email, sent: result.sent });
      }
      await loadData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível enviar a redefinição de senha deste usuário.');
    } finally {
      setResettingPasswordUser(null);
      setIsResettingPassword(false);
    }
  };

  const menuItemsFor = (user: SystemUser): MenuItem[] => {
    const items: MenuItem[] = [{ label: 'Trocar perfil', icon: Pencil, onSelect: () => openEditModal(user) }];
    if (!user.employeeId && canLinkEmployees) {
      items.push({ label: 'Vincular funcionário', icon: Link2, onSelect: () => openLinkModal(user) });
    }
    if (user.status === 'invited') {
      if (callerIsAdmin || user.role !== 'admin') {
        items.push({ label: 'Reenviar convite', icon: Send, onSelect: () => handleResendInvite(user), disabled: pendingUserId === user.id });
      }
    } else {
      items.push({ label: 'Enviar redefinição de senha', icon: KeyRound, onSelect: () => setResettingPasswordUser(user) });
    }
    items.push(
      isBlockedStatus(user.status)
        ? { label: 'Desbloquear acesso', icon: ShieldCheck, onSelect: () => handleToggleStatus(user), disabled: pendingUserId === user.id }
        : { label: 'Bloquear acesso', icon: ShieldOff, onSelect: () => handleToggleStatus(user), disabled: pendingUserId === user.id },
      { label: 'Excluir login', icon: Trash2, onSelect: () => setDeletingUser(user), tone: 'danger', separated: true },
    );
    return items;
  };

  const profileOptions = (current?: string | null) => profiles.filter(
    (p) => (callerIsAdmin || !p.isProtected || p.id === current) && (coveredProfileIds.has(p.id) || p.id === current),
  );

  const loginLimit = plan?.current.limits.maxEmployeeLogins;
  const planLine = plan && (
    <p className="-mt-3 mb-6 text-[13px] text-muted">
      Logins de funcionário:{' '}
      <span className="text-foreground tabular">
        {plan.usage.employeeLogins}{loginLimit == null ? '' : ` de ${loginLimit}`}
      </span>
      {loginLimit == null ? ` (sem limite no plano ${plan.current.label})` : ` no plano ${plan.current.label}`}
      {loginLimit != null && plan.usage.employeeLogins >= loginLimit && ' — limite atingido'}
      . Administradores não contam.
    </p>
  );

  const emptyState = users.length === 0 ? (
    <EmptyState title="Nenhum login ainda" description="Crie um acesso para alguém da sua equipe entrar no sistema." />
  ) : (
    <EmptyState
      title="Nenhum login encontrado"
      description={searchQuery ? `Nada corresponde a “${searchQuery}” neste filtro.` : 'Nenhum login nesta situação.'}
      action={<Button variant="secondary" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>Limpar busca e filtro</Button>}
    />
  );

  const editingModules = editingUser?.modules ?? [];

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Usuários e acessos"
          description="Quem entra no sistema e com qual perfil de acesso."
          actions={canManageUsers && canCreateLogins ? <Button icon={UserPlus} onClick={openNewModal}>Novo acesso</Button> : undefined}
        />
        {planLine}
        {canManageUsers && !canCreateLogins && <Notice className="mb-4">{LINK_REQUIRES_FULL_SCOPE_HINT}</Notice>}

        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search size={16} strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por e-mail, funcionário ou perfil"
              aria-label="Buscar logins"
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
          <div className="overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0">
            <SegmentedControl<StatusFilter>
              label="Filtrar por situação"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: `Todos ${counts.all}` },
                { value: 'active', label: `Ativos ${counts.active}` },
                { value: 'invited', label: `Convites ${counts.invited}` },
                { value: 'blocked', label: `Bloqueados ${counts.blocked}` },
              ]}
            />
          </div>
        </div>

        {loadError && <Notice tone="danger" className="mb-4">{loadError}</Notice>}
        {!isModalOpen && !editingUser && !linkingUser && actionError && (
          <Notice tone="danger" className="mb-4" onDismiss={() => setActionError(null)}>{actionError}</Notice>
        )}

        <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border" aria-label="Carregando logins" role="status">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-6 px-5 h-16">
                  <span className="skeleton h-4 w-52" />
                  <span className="skeleton h-4 w-28 hidden md:block" />
                  <span className="skeleton h-4 w-28 hidden sm:block" />
                  <span className="skeleton h-4 w-16 ml-auto" />
                </div>
              ))}
            </div>
          ) : loadError ? null : filteredUsers.length > 0 ? (
            <Table>
              <THead>
                <tr>
                  <TH>Login</TH>
                  <TH className="hidden lg:table-cell">Vínculo</TH>
                  <TH className="hidden md:table-cell">Perfil</TH>
                  <TH className="hidden sm:table-cell">Situação</TH>
                  {canManageUsers && <TH align="right"><span className="sr-only">Ações</span></TH>}
                </tr>
              </THead>
              <TBody>
                {filteredUsers.map((user) => {
                  const linkedEmployeeName = user.employeeId ? employeeNameById.get(user.employeeId) : undefined;
                  const canAct = canManageUsers && canActOnUser(user);
                  const status = STATUS_BADGE[statusGroup(user.status)];
                  const profileName = user.profileId ? profileNameById.get(user.profileId) : undefined;
                  const visibleModules = user.modules.slice(0, MAX_INLINE_MODULES).map(moduleLabel).join(', ');
                  const hiddenModules = user.modules.length - MAX_INLINE_MODULES;
                  const vinculo = user.employeeId
                    ? linkedEmployeeName ?? 'Funcionário vinculado'
                    : user.role === 'employee' ? 'Sem funcionário vinculado' : 'Sem ficha';
                  return (
                    <TR key={user.id} interactive={canAct} onClick={() => canAct && openEditModal(user)}>
                      <TD>
                        <div className="max-w-[200px] sm:max-w-[280px] lg:max-w-none">
                          <p className="font-medium text-foreground truncate">{user.email}</p>
                          <p className="text-[12px] text-muted">
                            {user.role === 'admin' ? 'Administrador' : 'Funcionário'}
                            <span className="sm:hidden"> · {status.label}</span>
                          </p>
                        </div>
                      </TD>
                      <TD className="hidden lg:table-cell text-muted">{vinculo}</TD>
                      <TD className="hidden md:table-cell">
                        <p className="text-foreground">{profileName ?? <span className="text-muted">Sem perfil</span>}</p>
                        <p className="text-[12px] text-muted" title={user.modules.map(moduleLabel).join(', ') || undefined}>
                          {user.modules.length === 0 ? 'Nenhum módulo' : `${visibleModules}${hiddenModules > 0 ? ` +${hiddenModules}` : ''}`}
                        </p>
                      </TD>
                      <TD className="hidden sm:table-cell"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></TD>
                      {canManageUsers && (
                        <TD align="right" onClick={(e) => e.stopPropagation()}>
                          {!canAct ? (
                            <span title={LOGIN_ABOVE_CALLER_MESSAGE} className="inline-flex items-center gap-1.5 text-[12px] text-muted">
                              <Lock size={13} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
                              <span className="sr-only">{LOGIN_ABOVE_CALLER_MESSAGE}</span>
                              <span aria-hidden="true">Sem ações</span>
                            </span>
                          ) : (
                            <Menu label="Ações" ariaLabel={`Ações de ${user.email}`} items={menuItemsFor(user)} />
                          )}
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            emptyState
          )}
        </div>
      </div>

      {/* Novo acesso */}
      <Modal
        open={isModalOpen}
        onClose={closeModal}
        title="Novo acesso"
        description="A pessoa recebe um convite por e-mail e cria a própria senha (o link vale 72 horas)."
        dismissable={!isSaving}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={isSaving}>Cancelar</Button>
            <Button type="submit" form="new-login-form" loading={isSaving} disabled={!isFormValid}>Criar acesso</Button>
          </>
        }
      >
        {actionError && <Notice tone="danger" className="mb-4">{actionError}</Notice>}
        <form id="new-login-form" onSubmit={handleCreateUser} className="space-y-4" noValidate>
          <Field label="E-mail do login" required error={emailError} htmlFor="new-login-email">
            <Input
              id="new-login-email" type="email" value={formData.email} invalid={!!emailError} data-autofocus
              onChange={(e) => { setFormData({ ...formData, email: e.target.value }); if (emailError) setEmailError(undefined); }}
              onBlur={() => setEmailError(formData.email && !isValidEmail(formData.email) ? 'E-mail inválido' : undefined)}
              placeholder="joao@empresa.com"
            />
          </Field>

          {roleOptions.length > 1 ? (
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-foreground">Tipo de acesso</p>
              <SegmentedControl<UserFormState['role']>
                label="Tipo de acesso"
                value={formData.role}
                onChange={(role) => setFormData({ ...formData, role, employeeId: '' })}
                options={roleOptions}
              />
            </div>
          ) : (
            <p className="text-[13px] text-muted">
              Tipo de acesso: <span className="text-foreground">{roleOptions[0]?.label}</span>
              {!canLinkEmployees && <span className="block mt-1">{LINK_REQUIRES_FULL_SCOPE_HINT}</span>}
            </p>
          )}

          {formData.role === 'employee' && (
            availableEmployees.length > 0 ? (
              <Field label="Funcionário" required htmlFor="new-login-employee" hint="Só fichas ativas que ainda não têm login.">
                <Select id="new-login-employee" value={formData.employeeId} onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}>
                  <option value="">Selecione um funcionário</option>
                  {availableEmployees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                </Select>
              </Field>
            ) : (
              <Notice>Nenhum funcionário ativo sem login. Cadastre um funcionário primeiro.</Notice>
            )
          )}

          <Field label="Perfil de acesso" required htmlFor="new-login-profile" hint="Define o que o login pode fazer. Os perfis ficam em Perfis de acesso.">
            <Select id="new-login-profile" value={formData.profileId} onChange={(e) => setFormData({ ...formData, profileId: e.target.value })}>
              <option value="">Selecione um perfil</option>
              {profileOptions().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </form>
      </Modal>

      {/* Trocar perfil */}
      <Modal
        open={!!editingUser}
        onClose={closeEditModal}
        title="Trocar perfil"
        description={editingUser?.email}
        dismissable={!isSavingEdit}
        footer={
          <>
            <Button variant="secondary" onClick={closeEditModal} disabled={isSavingEdit}>Cancelar</Button>
            <Button type="submit" form="edit-profile-form" loading={isSavingEdit} disabled={!editProfileId}>Salvar perfil</Button>
          </>
        }
      >
        {actionError && <Notice tone="danger" className="mb-4">{actionError}</Notice>}
        <div className="mb-4 rounded-md border border-border px-4 py-3">
          <p className="text-[12px] text-muted">Módulos que este login acessa hoje</p>
          <p className="mt-1 text-[14px] text-foreground">
            {editingModules.length === 0 ? 'Nenhum módulo' : editingModules.map(moduleLabel).join(', ')}
          </p>
        </div>
        <form id="edit-profile-form" onSubmit={handleSaveProfile}>
          <Field label="Perfil de acesso" required htmlFor="edit-profile" hint="Muda na hora o que o login pode fazer e encerra as sessões abertas dele.">
            <Select id="edit-profile" value={editProfileId} onChange={(e) => setEditProfileId(e.target.value)} data-autofocus>
              {!editProfileId && <option value="">Selecione um perfil</option>}
              {profileOptions(editingUser?.profileId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </form>
      </Modal>

      {/* Vincular funcionário */}
      <Modal
        open={!!linkingUser}
        onClose={closeLinkModal}
        title="Vincular funcionário"
        description={linkingUser?.email}
        dismissable={!isLinking}
        footer={
          <>
            <Button variant="secondary" onClick={closeLinkModal} disabled={isLinking}>Cancelar</Button>
            <Button type="submit" form="link-employee-form" loading={isLinking} disabled={!linkEmployeeId}>Vincular</Button>
          </>
        }
      >
        {actionError && <Notice tone="danger" className="mb-4">{actionError}</Notice>}
        <form id="link-employee-form" onSubmit={handleConfirmLink}>
          {availableEmployees.length > 0 ? (
            <Field
              label="Funcionário" required htmlFor="link-employee"
              hint="O alcance deste login (próprio cadastro, equipe ou departamento) passa a ser calculado a partir desta ficha."
            >
              <Select id="link-employee" value={linkEmployeeId} onChange={(e) => setLinkEmployeeId(e.target.value)} data-autofocus>
                <option value="">Selecione um funcionário</option>
                {availableEmployees.map(e => <option key={e.id} value={e.id}>{e.fullName}</option>)}
              </Select>
            </Field>
          ) : (
            <Notice>Nenhum funcionário ativo sem login. Cadastre um funcionário primeiro.</Notice>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deletingUser}
        onClose={() => !isDeleting && setDeletingUser(null)}
        onConfirm={handleConfirmDelete}
        title="Excluir este login?"
        description={deletingUser ? `${deletingUser.email} será excluído de vez. Diferente de bloquear, não dá para desfazer.` : undefined}
        confirmLabel="Excluir login"
        tone="danger"
        busy={isDeleting}
      />

      <ConfirmDialog
        open={!!resettingPasswordUser}
        onClose={() => !isResettingPassword && setResettingPasswordUser(null)}
        onConfirm={handleConfirmResetPassword}
        title="Enviar redefinição de senha?"
        description={resettingPasswordUser ? `Um link será enviado para ${resettingPasswordUser.email}.` : undefined}
        confirmLabel="Enviar link"
        busy={isResettingPassword}
      >
        <p className="text-[14px] text-muted">
          Nada muda até a pessoa usar o link. Ao redefinir, a senha atual deixa de funcionar e as sessões abertas desse login são encerradas.
        </p>
      </ConfirmDialog>

      {/* Aviso de convite/redefinição — fecha só por ação explícita (sem Esc nem clique fora). */}
      <Modal
        open={!!userNotice}
        onClose={closeUserNotice}
        dismissable={false}
        size="sm"
        title={userNotice?.kind === 'reset' ? 'Redefinição de senha enviada' : 'Convite enviado'}
        footer={
          <Button onClick={closeUserNotice}>
            {userNotice?.kind === 'invite' && userNotice.inviteUrl ? 'Já copiei, fechar' : 'Fechar'}
          </Button>
        }
      >
        {userNotice?.kind === 'invite' ? (
          <>
            <p className="text-[14px] text-muted">
              {userNotice.sent && !userNotice.inviteUrl ? (
                // Ruling R-final (29/09/2026): quem não pode vincular fichas nunca recebe o link cru
                // do convite, só a confirmação de que o e-mail saiu.
                <>Convite enviado por e-mail para <span className="text-foreground break-all">{userNotice.email}</span>. A pessoa cria a própria senha pelo link recebido (válido por 72 horas).</>
              ) : userNotice.sent ? (
                <>Convite enviado para <span className="text-foreground break-all">{userNotice.email}</span>. A pessoa cria a própria senha pelo link (válido por 72 horas).</>
              ) : userNotice.inviteUrl ? (
                <>Não conseguimos confirmar o envio do e-mail para <span className="text-foreground break-all">{userNotice.email}</span>. Copie o link abaixo e envie você mesmo (vale 72 horas).</>
              ) : (
                <>Não conseguimos enviar o convite para <span className="text-foreground break-all">{userNotice.email}</span>. Tente “Reenviar convite” na lista em instantes.</>
              )}
            </p>
            {userNotice.inviteUrl && (
              <div className="mt-4">
                <p className="mb-1.5 text-[12px] text-muted">Link do convite</p>
                <code className="block break-all rounded-md border border-border bg-secondary px-3 py-2 text-[12px] text-foreground">
                  {userNotice.inviteUrl}
                </code>
                <Button variant="secondary" className="mt-3 w-full" icon={copied ? Check : Copy} onClick={handleCopyInviteLink}>
                  {copied ? 'Link copiado' : 'Copiar link do convite'}
                </Button>
              </div>
            )}
          </>
        ) : userNotice && (
          <p className="text-[14px] text-muted">
            {userNotice.sent ? (
              <>Enviamos um link de redefinição para <span className="text-foreground break-all">{userNotice.email}</span>.</>
            ) : (
              <>Não conseguimos confirmar o envio do e-mail de redefinição para <span className="text-foreground break-all">{userNotice.email}</span>. Tente de novo em instantes.</>
            )}
          </p>
        )}
      </Modal>
    </div>
  );
};

export default UsersManagement;
