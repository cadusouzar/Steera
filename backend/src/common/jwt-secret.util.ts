// Valor exato de JWT_ACCESS_SECRET em backend/.env.example — se esse arquivo
// (ou uma variação óbvia dele) acabar rodando em qualquer ambiente real, é um
// segredo público conhecido: qualquer pessoa pode forjar um JWT válido pra
// QUALQUER empresa/usuário (inclusive role: 'ADMIN') e derrubar todo o
// isolamento multi-tenant. Ver CLAUDE.md, seção de Autenticação/multi-tenant.
export const JWT_SECRET_PLACEHOLDER = 'troque-por-um-valor-aleatorio-longo-em-producao';
const JWT_SECRET_PLACEHOLDER_PREFIX = 'troque-por-';

// Comprimento mínimo pra resistir a força bruta contra uma chave HMAC-SHA256
// (JWT_ACCESS_SECRET é assinado com HS256 — ver jwt.strategy.ts/auth.service.ts).
const JWT_SECRET_MIN_LENGTH = 32;

// Checagem de boot, chamada em main.ts antes de app.listen(). Nunca deixa o
// backend subir com um segredo de JWT ausente, curto demais, ou igual/derivado
// do placeholder de .env.example — nenhum dos dois pontos que assinam/validam
// o token (AuthService.signAccessToken, JwtStrategy) faz essa validação
// sozinho, então isso precisa acontecer antes de qualquer um dos dois rodar.
export function validateJwtSecret(secret: string | undefined): void {
  if (!secret) {
    throw new Error(
      'JWT_ACCESS_SECRET não está definido. Gere um valor aleatório real ' +
        '(ex.: `openssl rand -hex 32` ou `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`) ' +
        'e defina JWT_ACCESS_SECRET no seu backend/.env antes de iniciar o servidor.',
    );
  }

  if (secret === JWT_SECRET_PLACEHOLDER || secret.startsWith(JWT_SECRET_PLACEHOLDER_PREFIX)) {
    throw new Error(
      'JWT_ACCESS_SECRET ainda está com o valor de exemplo de backend/.env.example ' +
        '(ou uma variação dele). Esse valor é público (está no repositório) — qualquer pessoa que ' +
        'o conheça pode forjar um token válido para qualquer empresa/usuário. Gere um valor ' +
        'aleatório real (ex.: `openssl rand -hex 32` ou ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`) ' +
        'e defina JWT_ACCESS_SECRET no seu backend/.env antes de iniciar o servidor.',
    );
  }

  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_ACCESS_SECRET tem só ${secret.length} caracteres — curto demais pra resistir a força ` +
        `bruta contra uma chave HMAC-SHA256 (mínimo de ${JWT_SECRET_MIN_LENGTH}). Gere um valor ` +
        'aleatório real (ex.: `openssl rand -hex 32` ou ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`) ' +
        'e defina JWT_ACCESS_SECRET no seu backend/.env antes de iniciar o servidor.',
    );
  }
}
