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
  // true pra um ADMIN (sempre) ou um EMPLOYEE marcado explicitamente com
  // acesso administrativo total ao módulo de Ponto (ver
  // PATCH /companies/me/users/:id/ponto-access) — usado pelo frontend pra
  // decidir entre a visão "minha equipe" (escopada por managerId) e a visão
  // "empresa inteira" das telas administrativas de Ponto.
  hasFullPontoAccess: boolean;
}

interface ApiUser {
  id: string;
  email: string;
  role: string;
  modules: string[];
  mustChangePassword: boolean;
  employeeId: string | null;
  hasFullPontoAccess: boolean;
}

// Access token só em memória — nunca localStorage/sessionStorage, pra
// reduzir o que um ataque de XSS conseguiria roubar. Isso significa que
// recarregar a página perde o token e precisa de restoreSession().
let accessToken: string | null = null;
let currentUser: CurrentUser | null = null;

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
  };
}

function applySession(data: { accessToken: string; user: ApiUser }): CurrentUser {
  accessToken = data.accessToken;
  currentUser = toCurrentUser(data.user);
  return currentUser;
}

function clearSession(): void {
  accessToken = null;
  currentUser = null;
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

export async function register(companyName: string, email: string, password: string): Promise<CurrentUser> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    credentials: 'include', // necessário pro cookie httpOnly do refresh token ir/voltar
    // X-Requested-With: mesma mitigação de CSRF do login acima (ver
    // AntiCsrfHeaderGuard no backend).
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ companyName, email, password }),
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
    currentUser = { ...currentUser, mustChangePassword: false };
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
let refreshInFlight: Promise<boolean> | null = null;

// Uma única tentativa de renovação silenciosa por chamada de API que falhe
// com 401 — evita loop infinito se o refresh também falhar. Chamadas
// concorrentes compartilham a mesma promise em voo (ver refreshInFlight
// acima) em vez de disparar múltiplos POST /auth/refresh.
export async function refreshOnce(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        // 429 (rate limit) NÃO é prova de que a sessão é inválida — é só
        // "tente de novo mais tarde". Sem essa distinção, um usuário que
        // recarrega a página várias vezes seguidas em pouco tempo (cada
        // reload chama refreshOnce() via RequireAuth) esgotava o bucket de
        // /auth/refresh e era deslogado à força por um 429, mesmo com uma
        // sessão perfeitamente válida — aí recarregava de novo, batia no
        // mesmo bucket ainda esgotado, e ficava preso nesse loop. Qualquer
        // outro !res.ok (401/403 de sessão expirada/revogada de verdade)
        // continua limpando a sessão normalmente.
        if (res.status !== 429) {
          clearSession();
        }
        return false;
      }
      const data = await res.json();
      accessToken = data.accessToken;
      return true;
    } catch {
      clearSession();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Chamado uma vez ao carregar o app (ex.: F5) — tenta renovar usando o
// cookie httpOnly, que sobrevive a um reload mesmo sem o token em memória,
// depois busca o perfil via GET /auth/me (POST /auth/refresh só devolve o
// accessToken, não quem é o usuário). Nunca lança — se não houver sessão
// válida (sem cookie, expirada ou revogada), resolve para null em vez de
// quebrar a inicialização do app. Delega a renovação em si a refreshOnce()
// pra compartilhar o mesmo guard de concorrência (ver refreshInFlight)
// caso restoreSession() seja chamada ao mesmo tempo que outra renovação.
export async function restoreSession(): Promise<CurrentUser | null> {
  try {
    const renewed = await refreshOnce();
    if (!renewed) return null;

    const meRes = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      credentials: 'include',
    });
    if (!meRes.ok) {
      clearSession();
      return null;
    }
    currentUser = toCurrentUser(await meRes.json());
    return currentUser;
  } catch {
    // Falha de rede (backend fora do ar, offline, etc.) — trata como "sem
    // sessão" em vez de propagar um erro não tratado na inicialização.
    clearSession();
    return null;
  }
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
  currentUser = toCurrentUser(await meRes.json());
  return currentUser;
}
