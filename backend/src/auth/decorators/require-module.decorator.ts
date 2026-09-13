import { SetMetadata } from '@nestjs/common';
import { AppModule } from '@prisma/client';

export const REQUIRED_MODULES_KEY = 'requiredModules';

// Semântica OR, não AND: o login passa se tiver PELO MENOS UM dos módulos
// listados (ver ModulesGuard). Mesmo padrão de SetMetadata de
// roles.decorator.ts, só que com sua própria chave ('requiredModules') pra
// não colidir com @Roles().
export const RequireModule = (...modules: AppModule[]) => SetMetadata(REQUIRED_MODULES_KEY, modules);
