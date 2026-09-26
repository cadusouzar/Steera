import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { SesEmailSender } from './ses-email.sender';

// Nunca toca a rede: o client é um objeto com `send` mockado — nenhum teste aqui chama a AWS.
describe('SesEmailSender', () => {
  const message = { to: 'a@b.com', subject: 'Oi', html: '<p>oi</p>', text: 'oi' };
  const FROM = 'Steera <no-reply@steera.com.br>';

  function makeClient(impl: (command: unknown) => Promise<unknown>) {
    const send = jest.fn<Promise<unknown>, [unknown]>(impl);
    return { client: { send } as unknown as SESv2Client, send };
  }

  it('envia um SendEmailCommand com remetente, destinatário e corpo Simple (UTF-8)', async () => {
    const { client, send } = makeClient(async () => ({ MessageId: 'm-1' }));
    await new SesEmailSender(client, FROM).send(message);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as unknown as SendEmailCommand;
    expect(command).toBeInstanceOf(SendEmailCommand);
    expect(command.input).toEqual({
      FromEmailAddress: FROM,
      Destination: { ToAddresses: ['a@b.com'] },
      Content: {
        Simple: {
          Subject: { Data: 'Oi', Charset: 'UTF-8' },
          Body: {
            Html: { Data: '<p>oi</p>', Charset: 'UTF-8' },
            Text: { Data: 'oi', Charset: 'UTF-8' },
          },
        },
      },
    });
  });

  it('relança com o nome/código do erro da AWS, sem credenciais na mensagem', async () => {
    const awsError = Object.assign(new Error('Email address is not verified. AKIASECRETKEY'), {
      name: 'MessageRejected',
      Code: 'MessageRejected',
      $metadata: { httpStatusCode: 400 },
    });
    const { client } = makeClient(async () => {
      throw awsError;
    });

    const err = (await new SesEmailSender(client, FROM).send(message).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('MessageRejected');
    expect(err.message).toContain('400');
    expect(err.message).not.toContain('AKIA');
  });

  it('erro sem name/código vira uma mensagem genérica, nunca undefined', async () => {
    const { client } = makeClient(async () => {
      throw 'falha estranha';
    });
    await expect(new SesEmailSender(client, FROM).send(message)).rejects.toThrow(/SES/);
  });
});
