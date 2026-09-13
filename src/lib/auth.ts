const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface CurrentUser {
  id: string;
  email: string;
  role: 'admin' | 'employee';
  modules: string[];
}

interface ApiUser {
  id: string;
  email: string;
  role: string;
  modules: string[];
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
  return { id: user.id, email: user.email, role: user.role.toLowerCase() as 'admin' | 'employee', modules: user.modules };
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || 'Não foi possível entrar');
  }
  return applySession(await res.json());
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  clearSession();
}

// Chamado uma vez ao carregar o app (ex.: F5) — tenta renovar usando o
// cookie httpOnly, que sobrevive a um reload mesmo sem o token em memória,
// depois busca o perfil via GET /auth/me (POST /auth/refresh só devolve o
// accessToken, não quem é o usuário). Nunca lança — se não houver sessão
// válida (sem cookie, expirada ou revogada), resolve para null em vez de
// quebrar a inicialização do app.
export async function restoreSession(): Promise<CurrentUser | null> {
  try {
    const refreshRes = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!refreshRes.ok) {
      clearSession();
      return null;
    }
    accessToken = (await refreshRes.json()).accessToken;

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

// Uma única tentativa de renovação silenciosa por chamada de API que falhe
// com 401 — evita loop infinito se o refresh também falhar.
export async function refreshOnce(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      clearSession();
      return false;
    }
    const data = await res.json();
    accessToken = data.accessToken;
    return true;
  } catch {
    clearSession();
    return false;
  }
}
