// Checagem de boot (chamada em main.ts, junto de validateJwtSecret) — nunca
// deixa o backend subir em produção sem uma chave real do Resend, o que
// silenciosamente faria todo e-mail transacional (confirmação, convite,
// redefinição de senha, bloqueio de conta) cair no LogEmailSender (só log,
// nunca chega no destinatário). Em dev, sem chave é um cenário válido e
// esperado — o e-mail simplesmente aparece no log do backend.
export function validateMailConfig(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) {
    throw new Error(
      'RESEND_API_KEY não está definido em produção. Sem uma chave real do Resend, nenhum ' +
        'e-mail transacional (confirmação de cadastro, convite, redefinição de senha, aviso de ' +
        'bloqueio de conta) chega ao destinatário — defina RESEND_API_KEY no ambiente antes de ' +
        'iniciar o servidor.',
    );
  }
}
