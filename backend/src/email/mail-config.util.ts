// Seleção do provedor de e-mail + checagem de boot. E-mail é pago por mensagem (Amazon SES), então a
// regra é: envio real só quando alguém pediu explicitamente — em produção o padrão é `ses`; em
// qualquer outro ambiente o padrão é `log` (nada sai), e mesmo com EMAIL_PROVIDER explícito em dev só
// os destinatários de EMAIL_DEV_ALLOWED_RECIPIENTS recebem de verdade (AllowlistEmailSender).
// NODE_ENV=test nunca envia nada real, em nenhuma hipótese.

export type EmailProvider = 'ses' | 'resend' | 'log';

const PROVIDERS: readonly EmailProvider[] = ['ses', 'resend', 'log'];
const SES_ENV_KEYS = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const;

export interface EmailSetup {
  /** Provedor pedido (EMAIL_PROVIDER, ou o padrão do ambiente). */
  selected: EmailProvider;
  /** Provedor que de fato vai ser usado. */
  active: EmailProvider;
  /** Por que nada real sai (quando `active` é `log`). */
  reason?: string;
  production: boolean;
  /** Só relevante fora de produção. */
  allowedRecipients: string[];
}

function trimmed(value: string | undefined): string {
  return (value ?? '').trim();
}

// Lê RESEND_API_KEY aparada — só espaços (ex.: `RESEND_API_KEY= ` copiado de um .env) conta como
// ausente.
export function readResendApiKey(env: NodeJS.ProcessEnv): string | undefined {
  const key = trimmed(env.RESEND_API_KEY);
  return key.length > 0 ? key : undefined;
}

// Região do SES, só quando AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY estão todas
// preenchidas (aparadas). Nunca devolve nem loga as credenciais — o SDK as lê sozinho do ambiente
// (cadeia padrão de provedores).
export function readSesRegion(env: NodeJS.ProcessEnv): string | undefined {
  if (SES_ENV_KEYS.some((key) => trimmed(env[key]).length === 0)) return undefined;
  return trimmed(env.AWS_REGION);
}

export function readDevAllowedRecipients(env: NodeJS.ProcessEnv): string[] {
  return trimmed(env.EMAIL_DEV_ALLOWED_RECIPIENTS)
    .split(',')
    .map((address) => address.trim().toLowerCase())
    .filter((address) => address.length > 0);
}

// `undefined` = valor desconhecido (erro de digitação) — validateMailConfig barra o boot.
function readSelectedProvider(env: NodeJS.ProcessEnv): EmailProvider | undefined {
  const raw = trimmed(env.EMAIL_PROVIDER).toLowerCase();
  if (!raw) return env.NODE_ENV === 'production' ? 'ses' : 'log';
  return (PROVIDERS as readonly string[]).includes(raw) ? (raw as EmailProvider) : undefined;
}

export function resolveEmailSetup(env: NodeJS.ProcessEnv): EmailSetup {
  const production = env.NODE_ENV === 'production';
  const allowedRecipients = readDevAllowedRecipients(env);
  const selected = readSelectedProvider(env);
  const base = { production, allowedRecipients };

  if (!selected) return { ...base, selected: 'log', active: 'log', reason: 'EMAIL_PROVIDER desconhecido' };
  // ConfigModule.forRoot() completa o process.env com o backend/.env de dev — um e2e herdaria
  // credenciais REAIS. NODE_ENV=test (o Jest sempre seta) nunca monta um provedor real.
  if (env.NODE_ENV === 'test') return { ...base, selected, active: 'log', reason: 'ambiente de teste' };
  if (selected === 'log') return { ...base, selected, active: 'log', reason: 'EMAIL_PROVIDER=log' };
  if (selected === 'ses' && !readSesRegion(env)) {
    return { ...base, selected, active: 'log', reason: 'credenciais da AWS ausentes' };
  }
  if (selected === 'resend' && !readResendApiKey(env)) {
    return { ...base, selected, active: 'log', reason: 'credenciais do Resend ausentes' };
  }
  return { ...base, selected, active: selected };
}

// Checagem de boot (chamada em main.ts, junto de validateJwtSecret). Em produção, nunca deixa o
// backend subir sem um provedor real com credenciais (todo e-mail transacional — confirmação,
// convite, redefinição de senha, bloqueio de conta — cairia no log, nunca chegaria ao destinatário).
// Em qualquer ambiente, um EMAIL_PROVIDER desconhecido falha o boot (erro de digitação nunca passa
// calado). Nunca inclui valores de credenciais na mensagem, só os NOMES das variáveis.
//
// FRONTEND_URL (fix final de "Acesso e sessões"): é a base de TODO link dos e-mails. Em produção, sem
// ela os links cairiam no default http://localhost:5173; http:// mandaria o token em texto puro.
export function validateMailConfig(env: NodeJS.ProcessEnv): void {
  const selected = readSelectedProvider(env);
  if (!selected) {
    throw new Error(
      `EMAIL_PROVIDER inválido. Valores aceitos: ${PROVIDERS.join(', ')} — corrija antes de iniciar o servidor.`,
    );
  }
  if (env.NODE_ENV !== 'production') return;

  if (selected === 'log') {
    throw new Error(
      'EMAIL_PROVIDER=log em produção: nenhum e-mail transacional chegaria ao destinatário. Use ses ' +
        '(padrão) ou resend.',
    );
  }
  if (selected === 'ses') {
    const missing = SES_ENV_KEYS.filter((key) => trimmed(env[key]).length === 0);
    if (missing.length > 0) {
      throw new Error(
        `Amazon SES sem configuração em produção (faltando: ${missing.join(', ')}). Sem isso, nenhum ` +
          'e-mail transacional (confirmação de cadastro, convite, redefinição de senha, aviso de ' +
          'bloqueio de conta) chega ao destinatário — defina essas variáveis antes de iniciar o servidor.',
      );
    }
  }
  if (selected === 'resend' && !readResendApiKey(env)) {
    throw new Error(
      'RESEND_API_KEY não está definido em produção (EMAIL_PROVIDER=resend). Sem uma chave real do ' +
        'Resend, nenhum e-mail transacional chega ao destinatário — defina RESEND_API_KEY antes de ' +
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

// Linha única pro log de boot (main.ts): provedor ativo e, fora de produção, o TAMANHO da allowlist
// — nunca endereços nem valores de credenciais.
export function describeEmailSetup(setup: EmailSetup): string {
  let line = `E-mail: provedor ativo = ${setup.active}`;
  if (setup.reason) line += ` (selecionado: ${setup.selected}; ${setup.reason})`;
  if (!setup.production) line += `; destinatários liberados em dev: ${setup.allowedRecipients.length}`;
  return line;
}

function checkProductionFrontendUrl(raw: string | undefined): string | null {
  const value = trimmed(raw);
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
