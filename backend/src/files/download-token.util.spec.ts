import { createHmac } from 'crypto';
import { generateDownloadToken, verifyDownloadToken } from './download-token.util';

describe('download-token.util', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
  });

  it('generates a token that verifies successfully for the same asset', () => {
    const token = generateDownloadToken('asset-1');
    expect(verifyDownloadToken('asset-1', token)).toBe(true);
  });

  it('rejects a token verified against a different asset id', () => {
    const token = generateDownloadToken('asset-1');
    expect(verifyDownloadToken('asset-2', token)).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(verifyDownloadToken('asset-1', 'garbage')).toBe(false);
  });

  it('rejects an expired token', () => {
    const payload = `asset-1.${Date.now() - 1000}`;
    const sig = createHmac('sha256', process.env.JWT_ACCESS_SECRET as string).update(payload).digest('hex');
    const expiredToken = `${Date.now() - 1000}.${sig}`;
    expect(verifyDownloadToken('asset-1', expiredToken)).toBe(false);
  });
});
