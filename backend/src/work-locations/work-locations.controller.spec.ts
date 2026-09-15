import { Test } from '@nestjs/testing';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { WorkLocationsController } from './work-locations.controller';
import { WorkLocationsService } from './work-locations.service';

describe('WorkLocationsController', () => {
  let controller: WorkLocationsController;
  let service: { create: jest.Mock; update: jest.Mock; remove: jest.Mock };
  let timeManagementAuth: { assertHasFullPontoAccess: jest.Mock };

  const fullAccessAdmin: AuthenticatedUser = { userId: 'u1', companyId: 'c1', role: 'ADMIN', modules: [], mustChangePassword: false, hasFullPontoAccess: true };
  const limitedAdmin: AuthenticatedUser = { ...fullAccessAdmin, hasFullPontoAccess: false };

  beforeEach(async () => {
    service = { create: jest.fn(), update: jest.fn(), remove: jest.fn() };
    timeManagementAuth = { assertHasFullPontoAccess: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [WorkLocationsController],
      providers: [
        { provide: WorkLocationsService, useValue: service },
        { provide: TimeManagementAuthService, useValue: timeManagementAuth },
      ],
    }).compile();
    controller = module.get(WorkLocationsController);
  });

  it('create() checks hasFullPontoAccess before delegating', async () => {
    service.create.mockResolvedValue({ id: 'loc-1' });
    await controller.create(fullAccessAdmin, { name: 'Sede', latitude: 0, longitude: 0, radiusMeters: 100 });
    expect(timeManagementAuth.assertHasFullPontoAccess).toHaveBeenCalledWith(fullAccessAdmin);
    expect(service.create).toHaveBeenCalled();
  });

  it('create() propagates the NotFoundException from assertHasFullPontoAccess and never calls the service', async () => {
    timeManagementAuth.assertHasFullPontoAccess.mockImplementation(() => { throw new Error('blocked'); });
    await expect(
      controller.create(limitedAdmin, { name: 'Sede', latitude: 0, longitude: 0, radiusMeters: 100 }),
    ).rejects.toThrow('blocked');
    expect(service.create).not.toHaveBeenCalled();
  });
});
