import {
  LAST_HOLDER_PROTECTED_PERMISSION_CODES,
  lastHolderErrorMessage,
  SUBSCRIPTION_MANAGE_PERMISSION,
} from './protected-permissions';
import { PERMISSION_CATALOG } from './permission-catalog';

describe('protected-permissions', () => {
  it('protege usuarios.gerenciar e assinatura.gerenciar (nessa ordem — usuários primeiro)', () => {
    expect(LAST_HOLDER_PROTECTED_PERMISSION_CODES).toEqual(['usuarios.gerenciar', 'assinatura.gerenciar']);
  });

  it('toda permissão protegida existe no catálogo', () => {
    const codes = PERMISSION_CATALOG.map((p) => p.code);
    for (const code of LAST_HOLDER_PROTECTED_PERMISSION_CODES) expect(codes).toContain(code);
  });

  it('SUBSCRIPTION_MANAGE_PERMISSION é assinatura.gerenciar', () => {
    expect(SUBSCRIPTION_MANAGE_PERMISSION).toBe('assinatura.gerenciar');
  });

  it('mensagem específica por permissão', () => {
    expect(lastHolderErrorMessage('usuarios.gerenciar')).toBe(
      'A empresa precisa ter pelo menos um login ativo com permissão para gerenciar usuários',
    );
    expect(lastHolderErrorMessage('assinatura.gerenciar')).toBe(
      'A empresa precisa ter pelo menos um login ativo com permissão para gerenciar a assinatura',
    );
  });
});
