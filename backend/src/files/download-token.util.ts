import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutos — curto de propósito, é um link de download pontual

function secret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new Error('JWT_ACCESS_SECRET ausente — não é possível gerar token de download');
  return s;
}

// Reaproveita o mesmo segredo do JWT de acesso (já validado no boot, já rotacionável do mesmo
// jeito) em vez de introduzir um segredo novo pra gerenciar — o risco é equivalente (quem tem um
// já teria o outro comprometido de qualquer forma).
export function generateDownloadToken(assetId: string): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${assetId}.${expiresAt}`;
  const signature = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${expiresAt}.${signature}`;
}

export function verifyDownloadToken(assetId: string, token: string): boolean {
  const [expiresAtStr, signature] = token.split('.');
  const expiresAt = Number(expiresAtStr);
  if (!expiresAtStr || !signature || Number.isNaN(expiresAt)) return false;
  if (Date.now() > expiresAt) return false;
  const payload = `${assetId}.${expiresAt}`;
  const expected = createHmac('sha256', secret()).update(payload).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
