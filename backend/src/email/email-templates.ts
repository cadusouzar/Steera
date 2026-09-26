// Templates de e-mail transacional da Steera. HTML simples, inline (sem CSS
// externo/imagens externas — muitos clientes de e-mail bloqueiam ambos), com
// um botão apontando pro link e o mesmo link cru repetido em texto puro (pra
// clientes sem HTML e pra quando o botão não funciona). `name`/`companyName`
// são texto livre digitado por alguém — sempre escapados antes de entrar no
// HTML (nunca no texto puro, que não interpreta marcação).
const FOOTER_TEXT = 'Steera · Se você não pediu isto, ignore este e-mail.';

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

function renderLayout(bodyHtml: string, link: string, buttonLabel: string): string {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td style="font-size:20px;font-weight:bold;color:#111827;padding-bottom:16px;">Steera</td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.5;color:#27272a;padding-bottom:24px;">${bodyHtml}</td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${link}" style="display:inline-block;background-color:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;">${buttonLabel}</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#71717a;padding-top:16px;border-top:1px solid #e4e4e7;">${FOOTER_TEXT}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

export function buildAppLink(path: string, token: string): string {
  // trim(): mesma normalização do validateMailConfig — um valor com espaços passa na checagem de boot
  // e não pode virar link quebrado aqui.
  const frontendUrl = (process.env.FRONTEND_URL?.trim() || 'http://localhost:5173').replace(/\/+$/, '');
  return `${frontendUrl}${path}?token=${encodeURIComponent(token)}`;
}

export function verifyEmailTemplate(name: string | null, link: string): EmailTemplate {
  const greeting = name ? `Olá, ${escapeHtml(name)}!` : 'Olá!';
  const greetingText = name ? `Olá, ${name}!` : 'Olá!';
  return {
    subject: 'Confirme seu e-mail na Steera',
    html: renderLayout(
      `${greeting}<br /><br />Confirme seu e-mail para ativar sua conta na Steera clicando no botão abaixo. Este link expira em 24 horas.`,
      link,
      'Confirmar e-mail',
    ),
    text: `${greetingText}\n\nConfirme seu e-mail para ativar sua conta na Steera acessando o link abaixo. Este link expira em 24 horas.\n\n${link}\n\n${FOOTER_TEXT}`,
  };
}

export function inviteTemplate(companyName: string, link: string): EmailTemplate {
  const safeCompanyName = escapeHtml(companyName);
  return {
    subject: `Você foi convidado para ${companyName} na Steera`,
    html: renderLayout(
      `Você foi convidado para acessar a <strong>${safeCompanyName}</strong> na Steera. Clique no botão abaixo para criar sua senha e acessar o sistema. Este link expira em 72 horas.`,
      link,
      'Aceitar convite',
    ),
    text: `Você foi convidado para acessar a ${companyName} na Steera. Acesse o link abaixo para criar sua senha e acessar o sistema. Este link expira em 72 horas.\n\n${link}\n\n${FOOTER_TEXT}`,
  };
}

export function passwordResetTemplate(link: string): EmailTemplate {
  return {
    subject: 'Redefinição de senha da Steera',
    html: renderLayout(
      'Recebemos um pedido para redefinir a senha da sua conta na Steera. Clique no botão abaixo para escolher uma nova senha. Este link expira em 30 minutos.',
      link,
      'Redefinir senha',
    ),
    text: `Recebemos um pedido para redefinir a senha da sua conta na Steera. Acesse o link abaixo para escolher uma nova senha. Este link expira em 30 minutos.\n\n${link}\n\n${FOOTER_TEXT}`,
  };
}

export function accountLockedTemplate(minutes: number, resetLink: string): EmailTemplate {
  return {
    subject: 'Sua conta Steera foi bloqueada temporariamente',
    html: renderLayout(
      `Detectamos várias tentativas de senha incorreta seguidas na sua conta Steera. Por segurança, sua conta ficou temporariamente bloqueada por ${minutes} minutos. Se preferir, você pode redefinir sua senha agora clicando no botão abaixo.`,
      resetLink,
      'Redefinir senha',
    ),
    text: `Detectamos várias tentativas de senha incorreta seguidas na sua conta Steera. Por segurança, sua conta ficou temporariamente bloqueada por ${minutes} minutos. Se preferir, redefina sua senha agora acessando o link abaixo.\n\n${resetLink}\n\n${FOOTER_TEXT}`,
  };
}

export function passwordChangedTemplate(): EmailTemplate {
  return {
    subject: 'Sua senha da Steera foi alterada',
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td style="font-size:20px;font-weight:bold;color:#111827;padding-bottom:16px;">Steera</td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.5;color:#27272a;padding-bottom:24px;">A senha da sua conta na Steera foi alterada com sucesso. Se você não fez essa alteração, entre em contato com o administrador da sua empresa imediatamente.</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#71717a;padding-top:16px;border-top:1px solid #e4e4e7;">${FOOTER_TEXT}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim(),
    text: `A senha da sua conta na Steera foi alterada com sucesso. Se você não fez essa alteração, entre em contato com o administrador da sua empresa imediatamente.\n\n${FOOTER_TEXT}`,
  };
}
