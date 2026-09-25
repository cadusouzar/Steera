const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface CurrentUser {
  id: string;
  email: string;
  role: 'admin' | 'employee';
  modules: string[];
  // true pra um login criado por um admin (UsersService.create(), senha
  // temporária gerada pelo sistema) que ainda não trocou a senha — nunca
  // true pra quem se registrou via POST /auth/register (escolheu a própria
  // senha). RequireAuth usa isso pra forçar a troca antes de liberar o app.
  mustChangePassword: boolean;
  // null pra um ADMIN recém-registrado (POST /auth/register nunca cria um
  // Employee) até ele se auto-vincular a um cadastro (PATCH
  // /auth/me/employee-link) — TimeTracking.tsx usa isso pra decidir entre o
  // fluxo normal de bater ponto e o estado vazio "vincule seu cadastro".
  employeeId: string | null;
  // Valor EFETIVO de acesso total ao módulo de Ponto, já normalizado pelo
  // backend (ver backend/src/auth/ponto-access.util.ts): true SÓ pra um login
  // `role: ADMIN` cuja coluna `hasFullPontoAccess` está ligada — um ADMIN pode
  // perfeitamente ter false (restrito ao próprio time, ver
  // PATCH /companies/me/users/:id/ponto-access), e um login EMPLOYEE NUNCA vê
  // true aqui, qualquer que seja o valor guardado no banco (a coluna nasce
  // `true` por default pra toda linha, inclusive EMPLOYEE — antes da
  // normalização de 15/09/2026 isso fazia um gerente EMPLOYEE achar que tinha
  // acesso total e tomar 404 em toda mutação). Usado pelo frontend pra decidir
  // entre a visão "minha equipe" (escopada por managerId) e a visão "empresa
  // inteira" das telas administrativas de Ponto — agora com exatamente o mesmo
  // significado que o backend aplica.
  hasFullPontoAccess: boolean;
  // Nome/plano reais da empresa (Company.name/planTier/maxEmployeeLogins) — usados pelo menu de
  // perfil (UserProfileDropdown/UserProfileDrawer) pra mostrar dados reais da conta em vez de
  // mock. Sempre presentes na prática (todo User tem uma Company); o tipo é nullable só porque o
  // backend devolve `null` defensivamente quando `company` não vem populado (nunca acontece fora
  // de teste unitário do backend).
  companyName: string | null;
  planTier: 'BASICO' | 'PRO' | 'EMPRESARIAL' | null;
  maxEmployeeLogins: number | null;
  // Nome do responsável (User.name) — null em logins criados pelo admin (sem nome ainda).
  name: string | null;
  personType: 'PJ' | 'PF' | null;
  // Documento sempre mascarado pelo backend — o valor cru nunca chega ao frontend.
  documentMasked: string | null;
  legalName: string | null;
  tradeName: string | null;
  // Telefone/endereço da empresa (só dígitos em telefone/CEP) — pra área "Minha conta" mostrar e
  // editar. companyAddress é null em empresas anteriores ao cadastro ampliado.
  companyPhone: string | null;
  companyAddress: CompanyAddress | null;
}

export interface CompanyAddress {
  zipCode: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
}

interface ApiUser {
  id: string;
  email: string;
  role: string;
  modules: string[];
  mustChangePassword: boolean;
  employeeId: string | null;
  hasFullPontoAccess: boolean;
  companyName: string | null;
  planTier: 'BASICO' | 'PRO' | 'EMPRESARIAL' | null;
  maxEmployeeLogins: number | null;
  name: string | null;
  personType: 'PJ' | 'PF' | null;
  documentMasked: string | null;
  legalName: string | null;
  tradeName: string | null;
  companyPhone?: string | null;
  companyAddress?: CompanyAddress | null;
}

// Access token só em memória — nunca localStorage/sessionStorage, pra
// reduzir o que um ataque de XSS conseguiria roubar. Isso significa que
// recarregar a página perde o token e precisa de restoreSession().
let accessToken: string | null = null;
let currentUser: CurrentUser | null = null;

// Quem precisa refletir mudanças do usuário atual sem recarregar (ex.: a barra do site depois de
// editar o nome em "Minha conta", ou de sair em outro componente). Toda gravação passa por aqui.
type CurrentUserListener = (user: CurrentUser | null) => void;
const currentUserListeners = new Set<CurrentUserListener>();

function setCurrentUser(user: CurrentUser | null): void {
  currentUser = user;
  currentUserListeners.forEach((listener) => listener(user));
}

export function subscribeCurrentUser(listener: CurrentUserListener): () => void {
  currentUserListeners.add(listener);
  return () => {
    currentUserListeners.delete(listener);
  };
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCurrentUser(): CurrentUser | null {
  return currentUser;
}

function toCurrentUser(user: ApiUser): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role.toLowerCase() as 'admin' | 'employee',
    modules: user.modules,
    mustChangePassword: user.mustChangePassword,
    employeeId: user.employeeId,
    hasFullPontoAccess: user.hasFullPontoAccess,
    companyName: user.companyName,
    planTier: user.planTier,
    maxEmployeeLogins: user.maxEmployeeLogins,
    name: user.name ?? null,
    personType: user.personType ?? null,
    documentMasked: user.documentMasked ?? null,
    legalName: user.legalName ?? null,
    tradeName: user.tradeName ?? null,
    companyPhone: user.companyPhone ?? null,
    companyAddress: user.companyAddress ?? null,
  };
}

function applySession(data: { accessToken: string; user: ApiUser }): CurrentUser {
  accessToken = data.accessToken;
  setCurrentUser(toCurrentUser(data.user));
  return currentUser!;
}

function clearSession(): void {
  accessToken = null;
  setCurrentUser(null);
}

export async function login(email: string, password: string): Promise<CurrentUser> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    credentials: 'include', // necessário pro cookie httpOnly do refresh token ir/voltar
    // X-Requested-With: mitigação simples de CSRF exigida pelo backend
    // (ver AntiCsrfHeaderGuard) — um <form> HTML cross-site não consegue
    // setar cabeçalhos customizados, então isso já barra esse vetor sem
    // precisar de um token CSRF de verdade.
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || 'Não foi possível entrar');
  }
  return applySession(await res.json());
}

export interface RegisterPayload {
  personType: 'PJ' | 'PF';
  document: string;
  legalName: string;
  tradeName?: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
  name: string;
  email: string;
  password: string;
}

export async function register(payload: RegisterPayload): Promise<CurrentUser> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    credentials: 'include', // necessário pro cookie httpOnly do refresh token ir/voltar
    // X-Requested-With: mesma mitigação de CSRF do login acima (ver
    // AntiCsrfHeaderGuard no backend).
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || 'Não foi possível criar a conta');
  }
  return applySession(await res.json());
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  clearSession();
}

// Usado pela troca de senha voluntária (futura tela de conta) e pelo fluxo
// forçado de RequireAuth/ForcedPasswordChange (mustChangePassword). Fica
// aqui, não em src/lib/api.ts, porque — como login/register/logout acima —
// mexe diretamente no `accessToken`/`currentUser` em memória deste módulo.
//
// O backend agora devolve um accessToken NOVO no corpo da resposta (com
// mustChangePassword: false já embutido no claim do JWT) — o token antigo,
// ainda em memória até este ponto, continuaria carregando
// mustChangePassword: true por até 15min (JwtAuthGuard lê isso do próprio
// JWT, não faz round-trip no banco a cada request). Sem aplicar esse token
// novo aqui, toda chamada de API seguinte nesta mesma sessão (inclusive
// navegar pro app logo após ForcedPasswordChange.onDone()) seria barrada
// com 403 até o token antigo expirar — quebraria a UX já validada de
// "acesso imediato ao app, sem precisar logar de novo".
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_URL}/auth/me/password`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || 'Não foi possível trocar a senha');
  }
  const data = (await res.json()) as { accessToken: string };
  accessToken = data.accessToken;
  if (currentUser) {
    setCurrentUser({ ...currentUser, mustChangePassword: false });
  }
}

// Garante que chamadas concorrentes a refreshOnce()/restoreSession()
// (ex.: duas requisições da API expirando ao mesmo tempo e caindo em 401,
// ou uma dessas rodando junto com restoreSession() na inicialização)
// aguardem a MESMA renovação em vez de cada uma disparar seu próprio
// POST /auth/refresh. O backend trata o reuso de um refresh token já
// rotacionado como roubo/replay e revoga a família inteira de tokens do
// usuário — sem esse guard, a segunda chamada concorrente derrubaria a
// sessão à toa. Isso NÃO cobre concorrência entre abas diferentes (cada
// aba tem sua própria memória JS, sem nada em comum pra compartilhar essa
// promise) — limitação aceita, fora do escopo deste guard.
// Resultado de uma tentativa de renovação/restauração. A distinção que importa (bug de 25/09/2026:
// "dou F5 e às vezes desloga") é entre a sessão ter ACABADO (`invalid`: 401/403 do servidor) e o
// servidor simplesmente não ter podido responder AGORA (`unavailable`: falha de rede — ex. o
// backend reiniciando no `nest --watch` —, 429 do limite de /auth/refresh, ou 5xx). Antes, qualquer
// falha virava "sem sessão" e o RequireAuth mandava pro login com o cookie de 30 dias ainda válido.
export type RefreshOutcome = 'ok' | 'invalid' | 'unavailable';

let refreshInFlight: Promise<RefreshOutcome> | null = null;

function isSessionRejected(status: number): boolean {
  return status === 401 || status === 403;
}

// Só `invalid` limpa a sessão; `unavailable` preserva tudo (inclusive o access token em memória,
// que pode continuar válido) pra quem chamou decidir tentar de novo.
export async function refreshSession(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async (): Promise<RefreshOutcome> => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        if (isSessionRejected(res.status)) {
          clearSession();
          return 'invalid';
        }
        return 'unavailable';
      }
      const data = await res.json();
      accessToken = data.accessToken;
      return 'ok';
    } catch {
      return 'unavailable';
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Uma única tentativa de renovação silenciosa por chamada de API que falhe
// com 401 — evita loop infinito se o refresh também falhar. Chamadas
// concorrentes compartilham a mesma promise em voo (ver refreshInFlight
// acima) em vez de disparar múltiplos POST /auth/refresh.
export async function refreshOnce(): Promise<boolean> {
  return (await refreshSession()) === 'ok';
}

export type RestoreResult =
  | { status: 'authenticated'; user: CurrentUser }
  | { status: 'unauthenticated' }
  | { status: 'unavailable' };

// Chamado ao carregar o app (ex.: F5) — tenta renovar usando o cookie
// httpOnly, que sobrevive a um reload mesmo sem o token em memória, depois
// busca o perfil via GET /auth/me (POST /auth/refresh só devolve o
// accessToken, não quem é o usuário). Nunca lança. `unavailable` significa
// "não deu pra confirmar agora" — NÃO é logout (ver RefreshOutcome acima).
export async function restoreSessionDetailed(): Promise<RestoreResult> {
  const outcome = await refreshSession();
  if (outcome === 'invalid') return { status: 'unauthenticated' };
  if (outcome === 'unavailable') return { status: 'unavailable' };
  try {
    const meRes = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    });
    if (!meRes.ok) {
      if (isSessionRejected(meRes.status)) {
        clearSession();
        return { status: 'unauthenticated' };
      }
      return { status: 'unavailable' };
    }
    const restored = toCurrentUser(await meRes.json());
    setCurrentUser(restored);
    return { status: 'authenticated', user: restored };
  } catch {
    return { status: 'unavailable' };
  }
}

// Versão simples pra quem só quer "tem usuário ou não" (ex.: a barra do site, que num
// `unavailable` só continua mostrando "Entrar" — sem risco, nada é apagado).
export async function restoreSession(): Promise<CurrentUser | null> {
  const result = await restoreSessionDetailed();
  return result.status === 'authenticated' ? result.user : null;
}

// Rebusca só o perfil (GET /auth/me), sem forçar uma renovação de refresh
// token como restoreSession() faz — usado depois de uma ação que muda um
// campo do próprio usuário sem re-logar (hoje só PATCH /auth/me/employee-link,
// ver TimeTracking.tsx). Assume que já existe uma sessão válida (o access
// token em memória ainda funciona); se não existir, propaga o erro como
// qualquer outra chamada autenticada — não tenta silenciosamente virar
// "sem sessão" como restoreSession() faz na inicialização.
export async function refreshCurrentUser(): Promise<CurrentUser> {
  const meRes = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: 'include',
  });
  if (!meRes.ok) throw new Error('Não foi possível atualizar os dados do usuário');
  const refreshed = toCurrentUser(await meRes.json());
  setCurrentUser(refreshed);
  return refreshed;
}

// PATCH autenticado com UMA renovação silenciosa em caso de 401 (access token de 15min expirado) —
// mesmo comportamento de request() em api.ts, que não dá pra usar aqui (api.ts importa este módulo).
async function authedPatch(path: string, body: unknown, isRetry = false): Promise<Response> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401 && !isRetry && (await refreshOnce())) return authedPatch(path, body, true);
  return res;
}

async function applyProfileResponse(res: Response, fallbackMessage: string): Promise<CurrentUser> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string | string[] });
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    throw new Error(res.status >= 500 ? 'Não foi possível salvar agora. Tente novamente em instantes.' : message || fallbackMessage);
  }
  const updated = toCurrentUser(await res.json());
  setCurrentUser(updated);
  return updated;
}

// Área "Minha conta": nome do próprio login (qualquer papel).
export async function updateMyName(name: string): Promise<CurrentUser> {
  return applyProfileResponse(await authedPatch('/auth/me', { name }), 'Não foi possível salvar o nome');
}

export interface CompanyProfilePayload {
  legalName: string;
  tradeName?: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  state: string;
}

// Área "Minha conta": dados cadastrais da empresa — o backend só aceita de um ADMIN (403 pro resto).
export async function updateMyCompany(payload: CompanyProfilePayload): Promise<CurrentUser> {
  return applyProfileResponse(await authedPatch('/auth/me/company', payload), 'Não foi possível salvar os dados da empresa');
}
