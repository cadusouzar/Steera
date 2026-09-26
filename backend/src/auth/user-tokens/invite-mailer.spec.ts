import { InviteMailer } from './invite-mailer';

describe('InviteMailer', () => {
  it('emite um token INVITE, envia o convite e devolve o MESMO link do e-mail', async () => {
    const userTokens = { issue: jest.fn().mockResolvedValue('raw-invite-token') };
    const email = { send: jest.fn().mockResolvedValue(true) };
    const mailer = new InviteMailer(userTokens as any, email as any);

    const result = await mailer.sendInvite('u1', 'novo@teste.com', 'Padaria Central');

    expect(userTokens.issue).toHaveBeenCalledWith('u1', 'INVITE');
    expect(result.inviteUrl).toContain('/aceitar-convite?token=raw-invite-token');
    expect(result.sent).toBe(true);
    const [message, context] = email.send.mock.calls[0];
    expect(context).toBe('invite');
    expect(message.to).toBe('novo@teste.com');
    expect(message.html).toContain(result.inviteUrl);
  });

  it('repassa sent=false quando o provedor recusa (EmailService nunca lança)', async () => {
    const mailer = new InviteMailer(
      { issue: jest.fn().mockResolvedValue('raw') } as any,
      { send: jest.fn().mockResolvedValue(false) } as any,
    );
    await expect(mailer.sendInvite('u1', 'a@a.com', 'X')).resolves.toMatchObject({ sent: false });
  });
});
