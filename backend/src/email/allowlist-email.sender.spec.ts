import { AllowlistEmailSender } from './allowlist-email.sender';
import { FakeEmailSender } from './fake-email.sender';

describe('AllowlistEmailSender', () => {
  const msg = (to: string) => ({ to, subject: 'Oi', html: '<p>oi</p>', text: 'oi' });

  it('destinatário na lista → provedor real (comparação sem diferenciar maiúsculas/espaços)', async () => {
    const real = new FakeEmailSender();
    const fallback = new FakeEmailSender();
    const sender = new AllowlistEmailSender(real, fallback, ['eu@steera.com.br']);

    await sender.send(msg('  EU@Steera.com.br '));

    expect(real.sent).toHaveLength(1);
    expect(fallback.sent).toHaveLength(0);
  });

  it('destinatário fora da lista → só o fallback (log), nunca o provedor real', async () => {
    const real = new FakeEmailSender();
    const fallback = new FakeEmailSender();
    const sender = new AllowlistEmailSender(real, fallback, ['eu@steera.com.br']);

    await sender.send(msg('outro@cliente.com'));

    expect(real.sent).toHaveLength(0);
    expect(fallback.sent).toEqual([msg('outro@cliente.com')]);
  });

  it('lista vazia → nada real é enviado', async () => {
    const real = new FakeEmailSender();
    const fallback = new FakeEmailSender();
    const sender = new AllowlistEmailSender(real, fallback, []);

    await sender.send(msg('eu@steera.com.br'));

    expect(real.sent).toHaveLength(0);
    expect(fallback.sent).toHaveLength(1);
  });

  it('entradas da lista também são normalizadas', async () => {
    const real = new FakeEmailSender();
    const sender = new AllowlistEmailSender(real, new FakeEmailSender(), [' Eu@Steera.com.br ']);
    await sender.send(msg('eu@steera.com.br'));
    expect(real.sent).toHaveLength(1);
  });
});
