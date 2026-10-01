import { BadRequestException } from '@nestjs/common';
import { assertStrongPassword, buildPasswordUserInputs, MIN_PASSWORD_SCORE } from './password-strength.util';

describe('password-strength.util', () => {
  it('exige nota mínima 3 (forte)', () => {
    expect(MIN_PASSWORD_SCORE).toBe(3);
  });

  it.each(['senha12345678', 'Senha@123', 'Teste@1234', 'Brasil2026!'])('rejeita senha fraca/comum "%s"', (pwd) => {
    expect(() => assertStrongPassword(pwd, [])).toThrow(BadRequestException);
  });

  it('aceita senha forte', () => {
    expect(() => assertStrongPassword('correto-cavalo-bateria-grampo', [])).not.toThrow();
    expect(() => assertStrongPassword('Xk9#mPq2vL', [])).not.toThrow();
  });

  it('rejeita senha montada com os dados da própria pessoa/empresa', () => {
    const inputs = buildPasswordUserInputs(['joao.silva@padaria.com', 'Padaria Central', 'João Silva']);
    expect(() => assertStrongPassword('padariacentral2026', inputs)).toThrow(BadRequestException);
    expect(() => assertStrongPassword('PadariaCentral#1', inputs)).toThrow(BadRequestException);
  });

  it('a mensagem é em português, começa com "Senha fraca" e traz a dica', () => {
    try {
      assertStrongPassword('padariacentral2026', buildPasswordUserInputs(['Padaria Central']));
      fail('deveria ter lançado');
    } catch (err) {
      const message = (err as BadRequestException).message;
      expect(message).toMatch(/^Senha fraca\. /);
      expect(message).toContain('dados pessoais');
    }
  });

  it('buildPasswordUserInputs separa e-mail e nomes em tokens, sem acento, e ignora vazios', () => {
    const inputs = buildPasswordUserInputs(['joao.silva@padaria.com', 'Padaria Central', null, undefined, '  ']);
    expect(inputs).toEqual(
      expect.arrayContaining(['joao.silva@padaria.com', 'joao', 'silva', 'padaria', 'padariacentral', 'central']),
    );
    expect(buildPasswordUserInputs(['João'])).toEqual(expect.arrayContaining(['joao']));
    expect(inputs).not.toContain('');
  });
});
