import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('hashes a password and verifies the correct plain text against it', async () => {
    const hash = await hashPassword('S3nhaForte!123');
    expect(hash).not.toBe('S3nhaForte!123');
    await expect(verifyPassword(hash, 'S3nhaForte!123')).resolves.toBe(true);
  });

  it('rejects an incorrect plain text against a real hash', async () => {
    const hash = await hashPassword('S3nhaForte!123');
    await expect(verifyPassword(hash, 'senha-errada')).resolves.toBe(false);
  });
});
