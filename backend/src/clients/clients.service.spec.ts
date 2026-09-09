import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: { client: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      client: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
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

  it('returns the client when found', async () => {
    const client = { id: '1', name: 'Ana', status: 'ACTIVE' };
    prisma.client.findUnique.mockResolvedValue(client);
    await expect(service.findOne('1')).resolves.toEqual(client);
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
