// Templates de e-mail transacional da Steera. HTML simples, inline (sem CSS
// externo/imagens externas — muitos clientes de e-mail bloqueiam ambos), com
// um botão apontando pro link e o mesmo link cru repetido em texto puro (pra
// clientes sem HTML e pra quando o botão não funciona). `name`/`companyName`
// são texto livre digitado por alguém — sempre escapados antes de entrar no
// HTML (nunca no texto puro, que não interpreta marcação).
const BRAND_COLOR = '#2563EB';
const SYSTEM_FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FOOTER_LINE_2 = 'Se não foi você, pode ignorar esta mensagem com segurança.';
const FOOTER_LINE_3 = 'Steera · steera.com.br';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

interface EmailLayoutOptions {
  /** Texto curto de pré-visualização (inbox preview line), escondido no corpo do e-mail. */
  preheader: string;
  heading: string;
  /** Cada string vira um parágrafo; nunca escapado aqui — quem monta já decide o que escapar. */
  paragraphs: string[];
  cta: {
    label: string;
    /** URL já pronta para uso em atributo `href` e em texto (não escapada aqui). */
    url: string;
  };
  /** Texto opcional exibido abaixo do botão, antes do rodapé (ex.: nota extra). */
  note?: string;
  /** Frase livre completando "Você recebeu este e-mail porque ...". */
  footerReason: string;
}

// Layout compartilhado por todos os templates: fundo cinza-claro, cartão branco
// centralizado, wordmark "Steera" em texto (sem imagem/fonte web), botão de CTA
// "à prova de bala" (tabela com fallback VML pro Outlook desktop) e o link cru
// logo abaixo, para quando o botão não renderiza. `role="presentation"` nas
// tabelas + `lang="pt-BR"` + `meta name="color-scheme"` para leitores de tela e
// clientes de e-mail que respeitam dark mode.
function renderEmailLayout(options: EmailLayoutOptions): string {
  const { preheader, heading, paragraphs, cta, note, footerReason } = options;
  // Escapado tanto pro atributo `href="..."` quanto pro texto cru exibido logo
  // abaixo do botão — o link é montado internamente (buildAppLink), mas nada
  // impede caracteres como `&` de aparecerem numa query string futura.
  const safeUrl = escapeHtml(cta.url);

  const paragraphsHtml = paragraphs
    .map(
      (paragraph) =>
        `<tr><td style="padding:0 0 16px 0;font-size:15px;line-height:1.6;color:#3f3f46;">${paragraph}</td></tr>`,
    )
    .join('');

  const noteHtml = note
    ? `<tr><td style="padding:0 0 24px 0;font-size:13px;line-height:1.5;color:#71717a;">${note}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>Steera</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:${SYSTEM_FONT_STACK};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f4f4f5;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
            <tr>
              <td style="padding:32px 40px 0 40px;">
                <span style="font-family:${SYSTEM_FONT_STACK};font-size:22px;font-weight:700;color:${BRAND_COLOR};letter-spacing:-0.02em;">Steera</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 0 40px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding:0 0 16px 0;font-size:19px;line-height:1.4;font-weight:600;color:#18181b;">${heading}</td>
                  </tr>
                  ${paragraphsHtml}
                  <tr>
                    <td style="padding:8px 0 24px 0;">
                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:46px;v-text-anchor:middle;width:260px;" arcsize="12%" stroke="f" fillcolor="${BRAND_COLOR}">
                        <w:anchorlock/>
                        <center style="color:#ffffff;font-family:${SYSTEM_FONT_STACK};font-size:16px;font-weight:600;">${cta.label}</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-->
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td align="center" bgcolor="${BRAND_COLOR}" style="border-radius:6px;">
                            <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${SYSTEM_FONT_STACK};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${cta.label}</a>
                          </td>
                        </tr>
                      </table>
                      <!--<![endif]-->
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 4px 0;font-size:13px;line-height:1.5;color:#71717a;">Se o botão não funcionar, copie e cole este link no navegador:</td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 24px 0;font-size:13px;line-height:1.5;color:${BRAND_COLOR};word-break:break-all;">${safeUrl}</td>
                  </tr>
                  ${noteHtml}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 32px 40px;border-top:1px solid #e4e4e7;">
                <p style="margin:0 0 4px 0;font-size:12px;line-height:1.5;color:#a1a1aa;">Você recebeu este e-mail porque ${footerReason}</p>
                <p style="margin:0 0 4px 0;font-size:12px;line-height:1.5;color:#a1a1aa;">${FOOTER_LINE_2}</p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">${FOOTER_LINE_3}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

interface PlainTextLayoutOptions {
  greeting?: string;
  paragraphs: string[];
  link: string;
  footerReason: string;
}

function renderPlainTextLayout(options: PlainTextLayoutOptions): string {
  const { greeting, paragraphs, link, footerReason } = options;
  const lines = [
    ...(greeting ? [greeting, ''] : []),
    ...paragraphs.flatMap((paragraph) => [paragraph, '']),
    link,
    '',
    `Você recebeu este e-mail porque ${footerReason}`,
    FOOTER_LINE_2,
    FOOTER_LINE_3,
  ];
  return lines.join('\n');
}

export function buildAppLink(path: string, token: string): string {
  // trim(): mesma normalização do validateMailConfig — um valor com espaços passa na checagem de boot
  // e não pode virar link quebrado aqui.
  const frontendUrl = (process.env.FRONTEND_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '');
  return `${frontendUrl}${path}?token=${encodeURIComponent(token)}`;
}

export function verifyEmailTemplate(name: string | null, link: string): EmailTemplate {
  const safeName = name ? escapeHtml(name) : null;
  const greetingHtml = safeName ? `Olá, ${safeName}!` : 'Olá!';
  const greetingText = name ? `Olá, ${name}!` : 'Olá!';
  return {
    subject: 'Confirme seu e-mail na Steera',
    html: renderEmailLayout({
      preheader: 'Confirme seu e-mail para começar a usar a Steera.',
      heading: 'Confirme seu e-mail',
      paragraphs: [
        `${greetingHtml} Falta pouco para começar a usar a Steera — clique no botão abaixo para confirmar seu e-mail e ativar sua conta.`,
        'Este link expira em 24 horas.',
      ],
      cta: { label: 'Confirmar e-mail', url: link },
      footerReason: 'criou uma conta na Steera com este endereço de e-mail.',
    }),
    text: renderPlainTextLayout({
      greeting: greetingText,
      paragraphs: [
        'Falta pouco para começar a usar a Steera — acesse o link abaixo para confirmar seu e-mail e ativar sua conta.',
        'Este link expira em 24 horas.',
      ],
      link,
      footerReason: 'criou uma conta na Steera com este endereço de e-mail.',
    }),
  };
}

export function inviteTemplate(companyName: string, link: string): EmailTemplate {
  const safeCompanyName = escapeHtml(companyName);
  return {
    subject: `Você foi convidado para ${companyName} na Steera`,
    html: renderEmailLayout({
      preheader: `Você foi convidado para acessar a ${safeCompanyName} na Steera.`,
      heading: 'Você foi convidado',
      paragraphs: [
        `Você foi convidado para acessar a <strong>${safeCompanyName}</strong> na Steera. Clique no botão abaixo para criar sua senha e acessar o sistema.`,
        'Este link expira em 72 horas.',
      ],
      cta: { label: 'Aceitar convite', url: link },
      footerReason: `um administrador da ${safeCompanyName} convidou você para acessar a Steera.`,
    }),
    text: renderPlainTextLayout({
      paragraphs: [
        `Você foi convidado para acessar a ${companyName} na Steera. Acesse o link abaixo para criar sua senha e acessar o sistema.`,
        'Este link expira em 72 horas.',
      ],
      link,
      footerReason: `um administrador da ${companyName} convidou você para acessar a Steera.`,
    }),
  };
}

export function passwordResetTemplate(link: string): EmailTemplate {
  return {
    subject: 'Redefinição de senha da Steera',
    html: renderEmailLayout({
      preheader: 'Seu link expira em 30 minutos.',
      heading: 'Redefinir sua senha',
      paragraphs: [
        'Recebemos um pedido para redefinir a senha da sua conta na Steera. Clique no botão abaixo para escolher uma nova senha.',
        'Este link expira em 30 minutos.',
      ],
      cta: { label: 'Redefinir senha', url: link },
      footerReason: 'foi solicitada a redefinição de senha desta conta na Steera.',
    }),
    text: renderPlainTextLayout({
      paragraphs: [
        'Recebemos um pedido para redefinir a senha da sua conta na Steera. Acesse o link abaixo para escolher uma nova senha.',
        'Este link expira em 30 minutos.',
      ],
      link,
      footerReason: 'foi solicitada a redefinição de senha desta conta na Steera.',
    }),
  };
}

export function accountLockedTemplate(minutes: number, resetLink: string): EmailTemplate {
  return {
    subject: 'Sua conta Steera foi bloqueada temporariamente',
    html: renderEmailLayout({
      preheader: `Sua conta ficou bloqueada por ${minutes} minutos por segurança.`,
      heading: 'Conta bloqueada temporariamente',
      paragraphs: [
        `Detectamos várias tentativas de senha incorreta seguidas na sua conta Steera. Por segurança, sua conta ficou temporariamente bloqueada por ${minutes} minutos.`,
        'Se preferir, você pode redefinir sua senha agora clicando no botão abaixo.',
      ],
      cta: { label: 'Redefinir senha', url: resetLink },
      footerReason: 'sua conta Steera teve várias tentativas de login malsucedidas.',
    }),
    text: renderPlainTextLayout({
      paragraphs: [
        `Detectamos várias tentativas de senha incorreta seguidas na sua conta Steera. Por segurança, sua conta ficou temporariamente bloqueada por ${minutes} minutos.`,
        'Se preferir, redefina sua senha agora acessando o link abaixo.',
      ],
      link: resetLink,
      footerReason: 'sua conta Steera teve várias tentativas de login malsucedidas.',
    }),
  };
}
