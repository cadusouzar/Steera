import { EmailService } from './email.service';
import { EmailMessage, EmailSender } from './email-sender';

describe('EmailService', () => {
  const message: EmailMessage = { to: 'a@b.com', subject: 'Oi', html: '<p>oi</p>', text: 'oi' };

  it('never throws and resolves false when the sender rejects', async () => {
    const sender: EmailSender = { send: jest.fn().mockRejectedValue(new Error('boom')) };
    const service = new EmailService(sender);

    await expect(service.send(message, 'teste')).resolves.toBe(false);
  });

  it('resolves true when the sender succeeds', async () => {
    const sender: EmailSender = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new EmailService(sender);

    await expect(service.send(message, 'teste')).resolves.toBe(true);
  });

  it('never logs the message body on failure', async () => {
    const sender: EmailSender = { send: jest.fn().mockRejectedValue(new Error('boom')) };
    const service = new EmailService(sender);
    const errorSpy = jest.spyOn((service as unknown as { logger: { error: (msg: string) => void } }).logger, 'error');

    await service.send(message, 'contexto-teste');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = errorSpy.mock.calls[0][0] as string;
    expect(loggedMessage).toContain('contexto-teste');
    expect(loggedMessage).toContain(message.to);
    expect(loggedMessage).not.toContain(message.html);
  });
});
