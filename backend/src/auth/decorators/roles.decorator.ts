import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: ('ADMIN' | 'EMPLOYEE')[]) => SetMetadata('roles', roles);
