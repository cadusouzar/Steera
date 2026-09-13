import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ClientTrashService } from './client-trash.service';

describe('ClientTrashService', () => {
  let service: ClientTrashService;
  let prisma: { client: { deleteMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { client: { deleteMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [ClientTrashService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ClientTrashService);
  });

  it('deletes clients past the 30-day cutoff with includeInRevenueReport=false', async () => {
    prisma.client.deleteMany.mockResolvedValue({ count: 3 });
    const count = await service.purgeExpiredTrash();
    expect(count).toBe(3);
    expect(prisma.client.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'INACTIVE', includeInRevenueReport: false }),
    });
  });

  it('purgeExpiredTrashCron never throws even when the purge fails', async () => {
    prisma.client.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(service.purgeExpiredTrashCron()).resolves.toBeUndefined();
  });
});
