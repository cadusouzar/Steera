import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ClientTrashService } from './client-trash.service';

describe('ClientTrashService', () => {
  let service: ClientTrashService;
  let prisma: { client: { deleteMany: jest.Mock }; company: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      client: { deleteMany: jest.fn() },
      // Single company by default — the RLS backstop requires
      // purgeExpiredTrashCron to establish a tenant context per Company row
      // (see client-trash.service.ts) before purging; one company keeps the
      // pre-existing assertions in this file meaningful.
      company: { findMany: jest.fn().mockResolvedValue([{ id: 'company-1', name: 'Empresa 1' }]) },
    };
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

  it('purgeExpiredTrashCron iterates every company, not just one (RLS backstop requires a tenant context per company)', async () => {
    prisma.company.findMany.mockResolvedValue([
      { id: 'company-1', name: 'Empresa 1' },
      { id: 'company-2', name: 'Empresa 2' },
      { id: 'company-3', name: 'Empresa 3' },
    ]);
    prisma.client.deleteMany.mockResolvedValue({ count: 1 });

    await service.purgeExpiredTrashCron();

    expect(prisma.client.deleteMany).toHaveBeenCalledTimes(3);
  });

  it('an error purging one company does not prevent the others from being purged', async () => {
    prisma.company.findMany.mockResolvedValue([
      { id: 'company-1', name: 'Empresa 1' },
      { id: 'company-2', name: 'Empresa 2' },
    ]);
    prisma.client.deleteMany
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ count: 2 });

    await expect(service.purgeExpiredTrashCron()).resolves.toBeUndefined();
    expect(prisma.client.deleteMany).toHaveBeenCalledTimes(2);
  });
});
