import { Injectable } from '@nestjs/common';
import { EmailService } from '../../email/email.service';
import { buildAppLink, inviteTemplate } from '../../email/email-templates';
import { UserTokensService } from './user-tokens.service';

// Convite de login ("Acesso e sessões", Task 7). Provider próprio (e não um método de AuthService)
// porque tanto AuthService (esqueci minha senha de um INVITED reenvia o convite) quanto UsersService
// (admin cria/reenvia convite) precisam dele: UsersModule importar AuthModule só por isso puxaria
// JwtModule/Passport/AuthorizationModule/o controller de auth inteiro pra dentro de UsersModule. Aqui
// dependemos só de UserTokensService (mesmo módulo) + EmailService (EmailModule é @Global) — sem
// ciclo, sem forwardRef.
@Injectable()
export class InviteMailer {
  constructor(
    private readonly userTokens: UserTokensService,
    private readonly email: EmailService,
  ) {}

  // Emite um token INVITE (invalida o convite pendente anterior do mesmo login, ver
  // UserTokensService.issue) e envia o e-mail. `inviteUrl` é o MESMO link do e-mail — o admin pode
  // copiá-lo se o e-mail não chegar. Não engole erro de issue(): quem chama decide (EmailService.send
  // já nunca lança). Nunca loga o link/token.
  async sendInvite(userId: string, email: string, companyName: string): Promise<{ inviteUrl: string; sent: boolean }> {
    const raw = await this.userTokens.issue(userId, 'INVITE');
    const inviteUrl = buildAppLink('/aceitar-convite', raw);
    const sent = await this.email.send({ to: email, ...inviteTemplate(companyName, inviteUrl) }, 'invite');
    return { inviteUrl, sent };
  }
}
