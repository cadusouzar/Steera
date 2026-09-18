import { PrismaClient, Scope } from '@prisma/client';
import { PERMISSION_CATALOG } from '../src/permissions/permission-catalog';
import { effectiveHasFullPontoAccess } from '../src/auth/ponto-access.util';

// Mapeia cada AppModule legado pros PermissionCodes que ele concedia — só os que existem hoje,
// sem inventar granularidade nova (ver spec, "Fora do escopo").
const MODULE_TO_PERMISSIONS: Record<string, string[]> = {
  DASHBOARD: ['dashboard.ver'],
  CLIENTES: ['clientes.ver', 'clientes.gerenciar'],
  RH_CARGOS: ['cargos.ver', 'cargos.gerenciar'],
  RH_FUNCIONARIOS: ['funcionarios.ver', 'funcionarios.gerenciar', 'ferias.gerenciar', 'advertencias.gerenciar', 'pagamentos.gerenciar'],
  PONTO_REGISTRO: ['ponto.registrar'],
  PONTO_ADMINISTRACAO: ['ponto.administrar'],
  COMERCIAL: ['comercial.ver'],
  OPERACOES: ['operacoes.ver'],
  FINANCAS: ['financas.lancamentos.ver', 'financas.lancamentos.gerenciar'],
  RH: [], // legado morto, nunca atribuído a login novo, nunca concede nada
};

interface LegacyUser {
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
  hasFullPontoAccess: boolean;
}

export interface ProfileSignature {
  name: string;
  isProtected: boolean;
  grants: { permissionCode: string; scope: Scope | null }[];
}

export function computeProfileSignature(user: LegacyUser): ProfileSignature {
  const permissionCodes = new Set<string>();
  for (const m of user.modules) {
    for (const code of MODULE_TO_PERMISSIONS[m] ?? []) permissionCodes.add(code);
  }

  const fullPonto = effectiveHasFullPontoAccess(user);

  const grants = [...permissionCodes].map((code) => {
    const def = PERMISSION_CATALOG.find((p) => p.code === code)!;
    if (def.validScopes.length === 0) return { permissionCode: code, scope: null };
    if (code === 'ponto.administrar') {
      // `fullPonto` só é relevante pra ADMIN (effectiveHasFullPontoAccess é sempre false pra
      // EMPLOYEE, por definição) — e este ramo só é de fato retornado pro caso "Legado"
      // (EMPLOYEE) mais abaixo, já que os dois ramos de ADMIN retornam seu próprio `allGrants`.
      // Pra EMPLOYEE, o scope aqui é só declarativo (a restrição real de quem administra o ponto
      // de quem vem de TimeManagementAuthService/managerId, não deste flag) — por isso sempre
      // EMPRESA nesse caso, nunca EQUIPE.
      const scope = user.role === 'ADMIN' && !fullPonto ? Scope.EQUIPE : Scope.EMPRESA;
      return { permissionCode: code, scope };
    }
    return { permissionCode: code, scope: Scope.EMPRESA };
  });

  if (user.role === 'ADMIN' && fullPonto) {
    // Administrador Geral: TODAS as permissões do catálogo, não só as que os modules já cobriam.
    const allGrants = PERMISSION_CATALOG.map((def) => ({
      permissionCode: def.code,
      scope: def.validScopes.length === 0 ? null : Scope.EMPRESA,
    }));
    return { name: 'Administrador Geral', isProtected: true, grants: allGrants };
  }

  if (user.role === 'ADMIN') {
    // ADMIN restrito de Ponto: todas as permissões, mas ponto.administrar respeita a restrição.
    const allGrants = PERMISSION_CATALOG.map((def) => {
      if (def.validScopes.length === 0) return { permissionCode: def.code, scope: null };
      if (def.code === 'ponto.administrar') return { permissionCode: def.code, scope: Scope.EQUIPE };
      return { permissionCode: def.code, scope: Scope.EMPRESA };
    });
    return { name: 'Administrador Geral (restrito ao Ponto)', isProtected: false, grants: allGrants };
  }

  const sortedModules = [...user.modules].filter((m) => m !== 'RH').sort();
  return { name: `Legado: ${sortedModules.join(', ')}`, isProtected: false, grants };
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.rls_bypass', 'on', true)");
    const users = await tx.user.findMany({ where: { profileId: null } });
    const profileCache = new Map<string, string>(); // `${companyId}:${signatureName}` -> profileId

    for (const user of users) {
      const signature = computeProfileSignature(user);
      const cacheKey = `${user.companyId}:${signature.name}`;
      let profileId = profileCache.get(cacheKey);

      if (!profileId) {
        const profile = await tx.profile.create({
          data: {
            companyId: user.companyId,
            name: signature.name,
            isProtected: signature.isProtected,
            permissions: {
              create: signature.grants.map((g) => ({
                companyId: user.companyId,
                permissionCode: g.permissionCode,
                scope: g.scope,
              })),
            },
          },
        });
        profileId = profile.id;
        profileCache.set(cacheKey, profileId);
      }

      await tx.user.update({ where: { id: user.id }, data: { profileId } });
    }

    console.log(`Backfill concluído: ${users.length} usuários, ${profileCache.size} perfis criados/reaproveitados.`);
  });
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
