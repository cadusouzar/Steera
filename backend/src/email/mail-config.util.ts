// Lê RESEND_API_KEY aparada — só espaços (ex.: `RESEND_API_KEY= ` copiado de um .env) conta como
// ausente. Único ponto de leitura da chave (email.module.ts, validateMailConfig, main.ts).
export function readResendApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const key = (env.RESEND_API_KEY ?? '').trim();
  return key.length > 0 ? key : undefined;
}

// Checagem de boot (chamada em main.ts, junto de validateJwtSecret) — nunca
// deixa o backend subir em produção sem uma chave real do Resend, o que
// silenciosamente faria todo e-mail transacional (confirmação, convite,
// redefinição de senha, bloqueio de conta) cair no LogEmailSender (só log,
// nunca chega no destinatário). Em dev, sem chave é um cenário válido e
// esperado — o e-mail simplesmente aparece no log do backend.
//
// Mesma lógica pra FRONTEND_URL (fix final de "Acesso e sessões"): é a base de TODO link dos
// e-mails (confirmar e-mail, convite, redefinir senha). Em produção, sem ela os links cairiam no
// default http://localhost:5173 — ninguém conseguiria abrir; http:// mandaria o token em texto puro.
export function validateMailConfig(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return;
  if (!readResendApiKey(env)) {
    throw new Error(
      'RESEND_API_KEY não está definido em produção. Sem uma chave real do Resend, nenhum ' +
        'e-mail transacional (confirmação de cadastro, convite, redefinição de senha, aviso de ' +
        'bloqueio de conta) chega ao destinatário — defina RESEND_API_KEY no ambiente antes de ' +
        'iniciar o servidor.',
    );
  }
  const frontendUrlError = checkProductionFrontendUrl(env.FRONTEND_URL);
  if (frontendUrlError) {
    throw new Error(
      `FRONTEND_URL inválido em produção (${frontendUrlError}). É a base de todo link enviado por ` +
        'e-mail (confirmação de cadastro, convite, redefinição de senha) — defina FRONTEND_URL com ' +
        'o endereço público do site, começando com https:// (ex.: https://app.steera.com.br), antes ' +
        'de iniciar o servidor.',
    );
  }
}

function checkProductionFrontendUrl(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return 'não está definido';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'não é uma URL válida';
  }
  if (url.protocol !== 'https:') return 'precisa começar com https://';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return 'não pode apontar para localhost';
  return null;
}
