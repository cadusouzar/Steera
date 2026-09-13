import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { getCurrentUser, restoreSession } from '../lib/auth';
import ForcedPasswordChange from './ForcedPasswordChange';

// Guarda de rota para tudo sob /app/*: no mount, se já não houver um
// usuário em memória (ex.: acabou de logar nesta mesma carga de página),
// tenta restaurar a sessão via cookie httpOnly (restoreSession -> refresh +
// /auth/me). Enquanto a checagem não resolve, não renderiza `children`/
// `<Outlet />` de jeito nenhum — nem por um instante — pra nunca vazar
// conteúdo protegido antes de saber se o usuário está autenticado.
const RequireAuth = () => {
  const [checked, setChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(!!getCurrentUser());
  // Espelha `currentUser.mustChangePassword` (login criado por um admin com
  // senha temporária, ver UsersService.create()/Fix 6) — enquanto true,
  // RequireAuth mostra ForcedPasswordChange no lugar do app inteiro, mesmo
  // com `authenticated` true.
  const [mustChangePassword, setMustChangePassword] = useState(!!getCurrentUser()?.mustChangePassword);
  // Em dev, o React.StrictMode invoca este efeito duas vezes por mount
  // (monta -> limpa -> monta de novo), o que dispararia duas chamadas
  // concorrentes de restoreSession() usando o MESMO cookie de refresh
  // ainda não rotacionado. O backend rotaciona o refresh token a cada uso
  // e trata a reapresentação do token já rotacionado como replay,
  // revogando a família inteira — ou seja, a segunda chamada derrubaria a
  // sessão que a primeira acabou de validar. Esse ref garante que só uma
  // chamada real de rede aconteça por mount, mesmo sob StrictMode; em
  // produção (sem StrictMode) o efeito já roda uma única vez de qualquer
  // forma, então esse guard não muda nada lá.
  const restoreAttempted = useRef(false);

  useEffect(() => {
    const existing = getCurrentUser();
    if (existing) {
      setMustChangePassword(existing.mustChangePassword);
      setChecked(true);
      return;
    }
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;
    restoreSession().then((user) => {
      setAuthenticated(!!user);
      setMustChangePassword(!!user?.mustChangePassword);
      setChecked(true);
    });
  }, []);

  if (!checked) return null;
  if (!authenticated) return <Navigate to="/login" replace />;
  if (mustChangePassword) {
    return <ForcedPasswordChange onDone={() => setMustChangePassword(false)} />;
  }
  return <Outlet />;
};

export default RequireAuth;
