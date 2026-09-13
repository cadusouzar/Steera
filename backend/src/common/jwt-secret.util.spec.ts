import { validateJwtSecret } from './jwt-secret.util';

describe('validateJwtSecret', () => {
  it('throws when the secret is undefined', () => {
    expect(() => validateJwtSecret(undefined)).toThrow();
  });

  it('throws when the secret is an empty string', () => {
    expect(() => validateJwtSecret('')).toThrow();
  });

  it('throws when the secret is shorter than the minimum length', () => {
    expect(() => validateJwtSecret('curto-demais')).toThrow();
  });

  it('throws when the secret is exactly the placeholder from .env.example', () => {
    expect(() => validateJwtSecret('troque-por-um-valor-aleatorio-longo-em-producao')).toThrow();
  });

  it('throws when the secret starts with the placeholder prefix, even if decorated/lengthened', () => {
    expect(() =>
      validateJwtSecret('troque-por-um-valor-aleatorio-longo-em-producao-mas-mais-longo-ainda'),
    ).toThrow();
  });

  it('does not throw for a long random-looking real secret', () => {
    expect(() =>
      validateJwtSecret('cd1816f8682e623f95dce3a975e7b4ad007e56eebe53a073842c47290e5d888867dbc7b3ae7e790fb0a6d96bb5111671'),
    ).not.toThrow();
  });
});
