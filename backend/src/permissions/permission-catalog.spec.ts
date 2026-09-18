import { PERMISSION_CATALOG, getPermissionDefinition } from './permission-catalog';

describe('PERMISSION_CATALOG', () => {
  it('has no duplicate codes', () => {
    const codes = PERMISSION_CATALOG.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('getPermissionDefinition throws for an unknown code', () => {
    expect(() => getPermissionDefinition('inexistente.acao')).toThrow('Permissão desconhecida no catálogo: inexistente.acao');
  });

  it('getPermissionDefinition returns the matching entry', () => {
    expect(getPermissionDefinition('usuarios.gerenciar').labelPt).toBe('Gerenciar Usuários e Perfis');
  });
});
