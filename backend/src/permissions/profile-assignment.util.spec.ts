import { Scope } from '@prisma/client';
import { recomputeAndSaveUserAccess, reassignUserProfile } from './profile-assignment.util';

function makeTx() {
  return {
    profilePermission: { findMany: jest.fn() },
    user: { update: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
  };
}

describe('recomputeAndSaveUserAccess', () => {
  it('recalcula modules/hasFullPontoAccess a partir dos grants do perfil e revoga refresh tokens', async () => {
    const tx = makeTx();
    tx.profilePermission.findMany.mockResolvedValue([
      { permissionCode: 'clientes.ver', scope: Scope.EMPRESA },
      { permissionCode: 'ponto.administrar', scope: Scope.EMPRESA },
    ]);

    await recomputeAndSaveUserAccess(tx as any, 'user-1', 'profile-1');

    expect(tx.profilePermission.findMany).toHaveBeenCalledWith({ where: { profileId: 'profile-1' } });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { modules: ['CLIENTES', 'PONTO_ADMINISTRACAO'], hasFullPontoAccess: true },
    });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe('reassignUserProfile', () => {
  it('troca o profileId e recalcula o acesso a partir do perfil NOVO', async () => {
    const tx = makeTx();
    tx.profilePermission.findMany.mockResolvedValue([{ permissionCode: 'dashboard.ver', scope: null }]);

    await reassignUserProfile(tx as any, 'user-1', 'profile-2');

    expect(tx.user.update).toHaveBeenNthCalledWith(1, { where: { id: 'user-1' }, data: { profileId: 'profile-2' } });
    expect(tx.profilePermission.findMany).toHaveBeenCalledWith({ where: { profileId: 'profile-2' } });
    expect(tx.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'user-1' },
      data: { modules: ['DASHBOARD'], hasFullPontoAccess: false },
    });
  });
});
