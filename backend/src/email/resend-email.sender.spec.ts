import { ResendEmailSender } from './resend-email.sender';

describe('ResendEmailSender', () => {
  const message = { to: 'a@b.com', subject: 'Oi', html: '<p>oi</p>', text: 'oi' };
  afterEach(() => jest.restoreAllMocks());

  it('POSTs to the Resend API with bearer auth and the configured sender', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    await new ResendEmailSender('re_test', 'Steera <no-reply@steera.com.br>').send(message);
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Steera <no-reply@steera.com.br>', to: ['a@b.com'], subject: 'Oi', html: '<p>oi</p>', text: 'oi',
    });
  });

  it('throws with the HTTP status when Resend rejects', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"message":"bad"}', { status: 422 }));
    await expect(new ResendEmailSender('re_test', 'x@y').send(message)).rejects.toThrow('422');
  });
});
