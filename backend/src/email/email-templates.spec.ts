import {
  accountLockedTemplate,
  buildAppLink,
  inviteTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
} from './email-templates';

describe('email templates', () => {
  const link = 'http://localhost:5173/confirmar?token=abc';

  it('verifyEmailTemplate contains the link, Steera and a Portuguese subject', () => {
    const tpl = verifyEmailTemplate('Ana', link);
    expect(tpl.subject).toBe('Confirme seu e-mail na Steera');
    expect(tpl.html).toContain(link);
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain('Steera');
    expect(tpl.text).toContain('Steera');
  });

  it('verifyEmailTemplate works without a name', () => {
    const tpl = verifyEmailTemplate(null, link);
    expect(tpl.html).toContain(link);
    expect(tpl.text).toContain(link);
  });

  it('verifyEmailTemplate escapes an unsafe name in html but not in text', () => {
    const tpl = verifyEmailTemplate('<script>alert(1)</script>', link);
    expect(tpl.html).not.toContain('<script>alert(1)</script>');
    expect(tpl.html).toContain('&lt;script&gt;');
  });

  it('inviteTemplate contains the link, Steera, the company name and a Portuguese subject', () => {
    const tpl = inviteTemplate('Acme Ltda', link);
    expect(tpl.subject).toBe('Você foi convidado para Acme Ltda na Steera');
    expect(tpl.html).toContain(link);
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain('Steera');
    expect(tpl.html).toContain('Acme Ltda');
  });

  it('inviteTemplate escapes an unsafe company name in html', () => {
    const tpl = inviteTemplate('<b>Acme</b> & Cia', link);
    expect(tpl.html).not.toContain('<b>Acme</b>');
    expect(tpl.html).toContain('&lt;b&gt;Acme&lt;/b&gt; &amp; Cia');
  });

  it('passwordResetTemplate contains the link, Steera and a Portuguese subject', () => {
    const tpl = passwordResetTemplate(link);
    expect(tpl.subject).toBe('Redefinição de senha da Steera');
    expect(tpl.html).toContain(link);
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain('Steera');
  });

  it('accountLockedTemplate mentions the minutes, the link, Steera and a Portuguese subject', () => {
    const tpl = accountLockedTemplate(15, link);
    expect(tpl.subject).toBe('Sua conta Steera foi bloqueada temporariamente');
    expect(tpl.html).toContain('15 minutos');
    expect(tpl.text).toContain('15 minutos');
    expect(tpl.html).toContain(link);
    expect(tpl.text).toContain(link);
    expect(tpl.html).toContain('Steera');
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
