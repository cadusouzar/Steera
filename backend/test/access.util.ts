import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { FakeEmailSender } from '../src/email/fake-email.sender';
import { EmailMessage } from '../src/email/email-sender';

// Toda empresa nova nasce com e-mail NÃO confirmado (EmailVerifiedGuard barra o ERP). Suítes que
// testam outra coisa confirmam logo após o cadastro — o guard relê o banco quando o token diz
// "pendente", então vale sem novo login.
export async function markEmailVerified(prisma: PrismaService, email: string): Promise<void> {
  await runAsSystem(() => prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } }));
}

// Aceita o convite de um login criado por POST /companies/me/users (a resposta traz inviteUrl).
export async function acceptInvite(app: INestApplication, inviteUrl: string, password: string): Promise<void> {
  const token = new URL(inviteUrl).searchParams.get('token')!;
  await request(app.getHttpServer())
    .post('/auth/accept-invite')
    .set('x-requested-with', 'XMLHttpRequest')
    .send({ token, password, acceptLegal: true })
    .expect(204);
}

export function tokenFromLink(text: string, path: string): string {
  const match = text.match(new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`));
  if (!match) throw new Error(`link ${path} não encontrado no e-mail`);
  return decodeURIComponent(match[1]);
}

// E-mails de bloqueio/reset são disparados fire-and-forget (runInBackground em AuthService) — o
// endpoint já respondeu antes do FakeEmailSender necessariamente ter recebido a mensagem. Faz
// polling curto (até ~2s) em vez de assumir que já está lá de forma síncrona.
export async function waitForEmail(
  sender: FakeEmailSender,
  to: string,
  timeoutMs = 2000,
): Promise<EmailMessage | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = sender.lastTo(to);
    if (found) return found;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
