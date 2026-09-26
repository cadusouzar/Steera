import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

// Lê o `token` da query UMA vez (fica só no estado do componente) e tira ele da barra de endereço e
// do histórico com history.replaceState — o link de redefinição/convite/confirmação não fica
// exposto na tela, no histórico do navegador nem num print/compartilhamento da URL. Usado pelas
// páginas de token (ResetPassword, AcceptInvite, VerifyEmail).
//
// replaceState direto no window (não navigate()): o React Router não fica sabendo da troca, então
// a `location` dele continua com o token — o que é o desejado aqui (um remount do StrictMode relê o
// mesmo valor), e nada mais na página depende da query.
export function useUrlToken(): string {
  const [searchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get('token') ?? '');

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return token;
}
