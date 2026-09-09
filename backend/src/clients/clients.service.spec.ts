import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: { client: Record<string, jest.Mock>; receivable: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      client: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      receivable: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [ClientsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ClientsService);
  });

  it('throws NotFoundException when client does not exist', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the client when found, with zeroed totals when it has no receivables', async () => {
    const client = { id: '1', name: 'Ana', status: 'ACTIVE' };
    prisma.client.findUnique.mockResolvedValue(client);
    await expect(service.findOne('1')).resolves.toEqual({
      ...client,
      totalPaid: 0,
      totalPending: 0,
      totalOverdue: 0,
    });
  });

  it('includes paid/pending/overdue totals scoped to the client', async () => {
    const client = { id: '1', name: 'Ana', status: 'ACTIVE' };
    prisma.client.findUnique.mockResolvedValue(client);
    prisma.receivable.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000 } }) // paid
      .mockResolvedValueOnce({ _sum: { amount: 250.5 } }) // pending
      .mockResolvedValueOnce({ _sum: { amount: 80 } }); // overdue

    const result = await service.findOne('1');

    expect(result.totalPaid).toBe(1000);
    expect(result.totalPending).toBe(250.5);
    expect(result.totalOverdue).toBe(80);

    // Every aggregate must be scoped to this client, and the pending/overdue
    // boundary must be UTC midnight (Prisma reads @db.Date back as UTC midnight).
    const wheres = prisma.receivable.aggregate.mock.calls.map((call) => call[0].where);
    expect(wheres.every((where) => where.clientId === '1')).toBe(true);
    for (const where of wheres.slice(1)) {
      const boundary: Date = where.dueDate.gte ?? where.dueDate.lt;
      expect(boundary.getUTCHours()).toBe(0);
      expect(boundary.getUTCMinutes()).toBe(0);
      expect(boundary.getUTCSeconds()).toBe(0);
      expect(boundary.getUTCMilliseconds()).toBe(0);
    }
  });

  it('updates only after confirming the client exists', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: '1' });
    prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE' });

    const result = await service.update('1', { status: 'INACTIVE' as any });

    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { status: 'INACTIVE' },
    });
    expect(result).toEqual({ id: '1', status: 'INACTIVE' });
  });
});
