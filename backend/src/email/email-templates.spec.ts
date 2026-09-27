import {
  accountLockedTemplate,
  buildAppLink,
  inviteTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
} from './email-templates';

describe('email templates', () => {
  const link = 'http://localhost:5173/confirmar?token=abc';

  it('verifyEmailTemplate contains the link (attribute and text), preheader, Steera, expiry and a Portuguese subject', () => {
    const tpl = verifyEmailTemplate('Ana', link);
    expect(tpl.subject).toBe('Confirme seu e-mail na Steera');
    expect(tpl.html).toContain(`href="${link}"`);
    expect(tpl.html).toContain(`>${link}<`);
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain('Steera');
    expect(tpl.html).toContain('Confirme seu e-mail para começar a usar a Steera.');
    expect(tpl.html).toContain('24 horas');
    expect(tpl.text).toContain('24 horas');
  });

  it('verifyEmailTemplate works without a name', () => {
    const tpl = verifyEmailTemplate(null, link);
    expect(tpl.html).toContain(`href="${link}"`);
    expect(tpl.text).toContain(link);
  });

  it('verifyEmailTemplate escapes an unsafe name in html but not in text', () => {
    const tpl = verifyEmailTemplate('<script>alert(1)</script>', link);
    expect(tpl.html).not.toContain('<script>alert(1)</script>');
    expect(tpl.html).toContain('&lt;script&gt;');
  });

  it('verifyEmailTemplate is a well-formed, accessible HTML document', () => {
    const tpl = verifyEmailTemplate('Ana', link);
    expect(tpl.html).toContain('<!DOCTYPE html>');
    expect(tpl.html).toContain('lang="pt-BR"');
  });

  it('inviteTemplate contains the link, Steera, the company name, preheader, expiry and a Portuguese subject', () => {
    const tpl = inviteTemplate('Acme Ltda', link);
    expect(tpl.subject).toBe('Você foi convidado para Acme Ltda na Steera');
    expect(tpl.html).toContain(`href="${link}"`);
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain('Steera');
    expect(tpl.html).toContain('Acme Ltda');
    expect(tpl.html).toContain('72 horas');
    expect(tpl.text).toContain('72 horas');
  });

  it('inviteTemplate escapes an unsafe company name in html', () => {
    const tpl = inviteTemplate('<b>Acme</b> & Cia', link);
    expect(tpl.html).not.toContain('<b>Acme</b>');
    expect(tpl.html).toContain('&lt;b&gt;Acme&lt;/b&gt; &amp; Cia');
  });

  it('passwordResetTemplate contains the link, Steera, preheader, expiry and a Portuguese subject', () => {
    const tpl = passwordResetTemplate(link);
    expect(tpl.subject).toBe('Redefinição de senha da Steera');
    expect(tpl.html).toContain(`href="${link}"`);
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain('Steera');
    expect(tpl.html).toContain('30 minutos');
    expect(tpl.text).toContain('30 minutos');
  });

  it('accountLockedTemplate mentions the minutes, the link, Steera, expiry and a Portuguese subject', () => {
    const tpl = accountLockedTemplate(15, link);
    expect(tpl.subject).toBe('Sua conta Steera foi bloqueada temporariamente');
    expect(tpl.html).toContain('15 minutos');
    expect(tpl.text).toContain('15 minutos');
    expect(tpl.html).toContain(`href="${link}"`);
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain('Steera');
  });

  it('every template has a footer explaining why it was received and no unsubscribe link', () => {
    const templates = [
      verifyEmailTemplate('Ana', link),
      inviteTemplate('Acme Ltda', link),
      passwordResetTemplate(link),
      accountLockedTemplate(15, link),
    ];
    for (const tpl of templates) {
      expect(tpl.html).toContain('Você recebeu este e-mail porque');
      expect(tpl.html).toContain('Se não foi você, pode ignorar esta mensagem com segurança.');
      expect(tpl.html).toContain('steera.com.br');
      expect(tpl.html.toLowerCase()).not.toContain('unsubscribe');
      expect(tpl.html.toLowerCase()).not.toContain('descadastr');
      expect(tpl.text).toContain('Se não foi você, pode ignorar esta mensagem com segurança.');
    }
  });

  it('every template tells the reader to copy and paste the link when the button does not work', () => {
    const templates = [
      verifyEmailTemplate('Ana', link),
      inviteTemplate('Acme Ltda', link),
      passwordResetTemplate(link),
      accountLockedTemplate(15, link),
    ];
    for (const tpl of templates) {
      expect(tpl.html).toContain('Se o botão não funcionar, copie e cole este link no navegador:');
    }
  });

  it('buildAppLink joins the frontend URL (without trailing slash), the path and the encoded token', () => {
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = 'http://x/';

    expect(buildAppLink('/redefinir-senha', 'a b')).toBe('http://x/redefinir-senha?token=a%20b');

    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('buildAppLink trims surrounding whitespace in FRONTEND_URL (the boot check trims too)', () => {
    const originalFrontendUrl = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = '  https://app.steera.com.br/  ';

    expect(buildAppLink('/redefinir-senha', 'tok')).toBe('https://app.steera.com.br/redefinir-senha?token=tok');

    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('buildAppLink defaults to localhost:5173 when FRONTEND_URL is unset', () => {
    const originalFrontendUrl = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;

    expect(buildAppLink('/confirmar', 'tok')).toBe('http://localhost:5173/confirmar?token=tok');

    process.env.FRONTEND_URL = originalFrontendUrl;
  });
});
