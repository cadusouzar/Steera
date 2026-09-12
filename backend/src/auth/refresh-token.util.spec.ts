import { generateRefreshTokenValue, hashRefreshToken } from './refresh-token.util';

describe('refresh-token.util', () => {
  it('generates a high-entropy value with no obvious collisions across calls', () => {
    const a = generateRefreshTokenValue();
    const b = generateRefreshTokenValue();
    expect(a).toHaveLength(64); // 32 bytes em hex
    expect(a).not.toBe(b);
  });

  it('hashes the same value to the same hash, deterministically', () => {
    const value = generateRefreshTokenValue();
    expect(hashRefreshToken(value)).toBe(hashRefreshToken(value));
  });

  it('hashes different values to different hashes', () => {
    expect(hashRefreshToken('a')).not.toBe(hashRefreshToken('b'));
  });
});
