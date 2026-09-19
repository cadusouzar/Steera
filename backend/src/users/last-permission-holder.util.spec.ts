import { BadRequestException } from '@nestjs/common';
import { assertNotLastHolderOfPermission } from './last-permission-holder.util';

describe('assertNotLastHolderOfPermission', () => {
  it('does not throw when another active user still holds the permission', async () => {
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ count: 2n }]) };
    await expect(assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1')).resolves.toBeUndefined();
  });

  it('throws when excluding this user would leave zero holders', async () => {
    const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ count: 1n }]) };
    await expect(assertNotLastHolderOfPermission(tx as any, 'company-1', 'usuarios.gerenciar', 'user-1'))
      .rejects.toThrow(BadRequestException);
  });
});
