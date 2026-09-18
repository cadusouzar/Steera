import { ValidationError } from 'class-validator';
import { translateValidationErrors } from './validation-message-translator.util';

function err(property: string, constraints: Record<string, string>, children: ValidationError[] = []): ValidationError {
  return { property, constraints, children, target: undefined, value: undefined } as ValidationError;
}

describe('translateValidationErrors', () => {
  it('traduz isNotEmpty', () => {
    expect(translateValidationErrors([err('nome', { isNotEmpty: 'nome should not be empty' })]))
      .toBe('Nome é obrigatório');
  });

  it('traduz isEmail', () => {
    expect(translateValidationErrors([err('email', { isEmail: 'email must be an email' })]))
      .toBe('E-mail deve ser um e-mail válido');
  });

  it('traduz minLength extraindo o número da mensagem original', () => {
    expect(translateValidationErrors([err('name', { minLength: 'name must be longer than or equal to 3 characters' })]))
      .toBe('Nome deve ter pelo menos 3 caracteres');
  });

  it('traduz maxLength extraindo o número da mensagem original', () => {
    expect(translateValidationErrors([err('description', { maxLength: 'description must be shorter than or equal to 2000 characters' })]))
      .toBe('Descrição deve ter no máximo 2000 caracteres');
  });

  it('traduz min e max extraindo o valor original', () => {
    expect(translateValidationErrors([err('amount', { min: 'amount must not be less than 0.01' })]))
      .toBe('Amount deve ser maior ou igual a 0.01');
    expect(translateValidationErrors([err('amount', { max: 'amount must not be greater than 100000000' })]))
      .toBe('Amount deve ser menor ou igual a 100000000');
  });

  it('usa CPF em maiúsculas via override de rótulo', () => {
    expect(translateValidationErrors([err('cpf', { isString: 'cpf must be a string' })]))
      .toBe('CPF deve ser um texto');
  });

  it('traduz os três campos de senha (achado no smoke test final: password caía no fallback em inglês)', () => {
    expect(translateValidationErrors([err('password', { minLength: 'password must be longer than or equal to 8 characters' })]))
      .toBe('Senha deve ter pelo menos 8 caracteres');
    expect(translateValidationErrors([err('currentPassword', { isNotEmpty: 'currentPassword should not be empty' })]))
      .toBe('Senha atual é obrigatório');
    expect(translateValidationErrors([err('newPassword', { minLength: 'newPassword must be longer than or equal to 8 characters' })]))
      .toBe('Nova senha deve ter pelo menos 8 caracteres');
  });

  it('converte um nome de campo camelCase desconhecido em palavras separadas', () => {
    expect(translateValidationErrors([err('someNewField', { isBoolean: 'someNewField must be a boolean value' })]))
      .toBe('Some new field deve ser verdadeiro ou falso');
  });

  it('mantém mensagens já customizadas (não inglês padrão) inalteradas', () => {
    expect(translateValidationErrors([err('colorHex', { matches: 'colorHex deve estar no formato #RRGGBB' })]))
      .toBe('colorHex deve estar no formato #RRGGBB');
  });

  it('junta múltiplos campos/erros com "; "', () => {
    const result = translateValidationErrors([
      err('email', { isEmail: 'email must be an email' }),
      err('nome', { isNotEmpty: 'nome should not be empty' }),
    ]);
    expect(result).toBe('E-mail deve ser um e-mail válido; Nome é obrigatório');
  });

  it('percorre error.children recursivamente (validação aninhada)', () => {
    const nested = err('email', { isEmail: 'email must be an email' });
    const parent = err('items', {}, [nested]);
    expect(translateValidationErrors([parent])).toBe('E-mail deve ser um e-mail válido');
  });

  it('devolve uma mensagem genérica quando não há nenhum erro (defensivo)', () => {
    expect(translateValidationErrors([])).toBe('Dados inválidos');
  });
});
