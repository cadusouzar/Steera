import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

// Semântica OR — igual RequireModule: passa se tiver PELO MENOS UMA das permissões listadas.
export const RequirePermission = (...codes: string[]) => SetMetadata(REQUIRED_PERMISSIONS_KEY, codes);
