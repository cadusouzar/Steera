import { buildPermissionDeniedMessage, getPermissionLabel } from './permission-labels';

describe('permission-labels', () => {
  describe('getPermissionLabel', () => {
    it('resolves ver actions for read codes', () => {
      expect(getPermissionLabel('clientes.ver')).toEqual({ area: 'Clientes', action: 'ver' });
      expect(getPermissionLabel('funcionarios.ver')).toEqual({ area: 'Funcionários', action: 'ver' });
      // action bruto do catálogo é `lancamentos.ver`, não `ver` — a derivação é pelo CÓDIGO.
      expect(getPermissionLabel('financas.lancamentos.ver')).toEqual({ area: 'Lançamentos', action: 'ver' });
    });

    it('resolves alterar actions for write/administrative codes', () => {
      expect(getPermissionLabel('clientes.gerenciar')).toEqual({ area: 'Clientes', action: 'alterar' });
      expect(getPermissionLabel('cargos.gerenciar')).toEqual({ area: 'Cargos', action: 'alterar' });
      expect(getPermissionLabel('funcionarios.gerenciar')).toEqual({ area: 'Funcionários', action: 'alterar' });
      expect(getPermissionLabel('advertencias.gerenciar')).toEqual({ area: 'Advertências', action: 'alterar' });
      expect(getPermissionLabel('pagamentos.gerenciar')).toEqual({ area: 'Pagamentos', action: 'alterar' });
      expect(getPermissionLabel('ferias.gerenciar')).toEqual({ area: 'Férias e afastamentos', action: 'alterar' });
      expect(getPermissionLabel('ponto.registrar')).toEqual({ area: 'Ponto', action: 'alterar' });
      expect(getPermissionLabel('ponto.administrar')).toEqual({ area: 'Ponto', action: 'alterar' });
      expect(getPermissionLabel('ponto.feriados.gerenciar')).toEqual({ area: 'Feriados', action: 'alterar' });
      expect(getPermissionLabel('usuarios.gerenciar')).toEqual({ area: 'Usuários e perfis', action: 'alterar' });
      expect(getPermissionLabel('campos-personalizados.gerenciar')).toEqual({
        area: 'Campos personalizados',
        action: 'alterar',
      });
    });

    it('falls back to a capitalized resource for an unmapped code', () => {
      expect(getPermissionLabel('dashboard.ver')).toEqual({ area: 'Dashboard', action: 'ver' });
    });
  });

  describe('buildPermissionDeniedMessage', () => {
    it('builds the exact human message for a read code', () => {
      expect(buildPermissionDeniedMessage('clientes.ver')).toBe(
        'Seu perfil não permite ver Clientes. Fale com quem administra os acessos da empresa.',
      );
    });

    it('builds the exact human message for a write code', () => {
      expect(buildPermissionDeniedMessage('clientes.gerenciar')).toBe(
        'Seu perfil não permite alterar Clientes. Fale com quem administra os acessos da empresa.',
      );
    });
  });
});
