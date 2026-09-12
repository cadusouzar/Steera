import { REQUEST } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from './company-context.service';

describe('CompanyContextService', () => {
  const buildService = async (request: any) => {
    const module = await Test.createTestingModule({
      providers: [CompanyContextService, { provide: REQUEST, useValue: request }],
    }).compile();
    return module.resolve(CompanyContextService);
  };

  it('returns the companyId of the currently authenticated user', async () => {
    const service = await buildService({ user: { userId: 'user-1', companyId: 'company-1', role: 'ADMIN', modules: [] } });
    const id = await service.getCurrentCompanyId();
    expect(id).toBe('company-1');
  });

  it('throws when called outside an authenticated request (no user on the request)', async () => {
    const service = await buildService({});
    await expect(service.getCurrentCompanyId()).rejects.toThrow(
      'CompanyContextService chamado fora de uma requisição autenticada',
    );
  });

  it('throws when the authenticated user has no companyId', async () => {
    const service = await buildService({ user: { userId: 'user-1', role: 'ADMIN', modules: [] } });
    await expect(service.getCurrentCompanyId()).rejects.toThrow(
      'CompanyContextService chamado fora de uma requisição autenticada',
    );
  });
});
