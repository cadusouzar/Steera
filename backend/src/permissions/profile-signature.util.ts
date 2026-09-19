import { Prisma, Scope } from '@prisma/client';
import { effectiveHasFullPontoAccess } from '../auth/ponto-access.util';
import { PERMISSION_CATALOG } from './permission-catalog';

// Mapeia cada AppModule legado pros PermissionCodes que ele concedia — só os que existem hoje,
// sem inventar granularidade nova (ver spec, "Fora do escopo").
//
// `ponto.feriados.gerenciar` foi adicionado a PONTO_ADMINISTRACAO na revisão final da branch
// (18/09/2026): HolidaysController exige `@RequireModule('PONTO_ADMINISTRACAO')` **e**
// `@Roles('ADMIN')` (holidays.controller.ts) — ou seja, o módulo é de fato parte do gate, e a
// ausência desse código aqui era uma lacuna real do mapa, não uma omissão intencional. Sem essa
// linha, intersectar os grants de um ADMIN com seus `modules` (ver abaixo) removeria silenciosamente
// o acesso a feriados de todo admin de módulos restritos que hoje tem PONTO_ADMINISTRACAO.
export const MODULE_TO_PERMISSIONS: Record<string, string[]> = {
  DASHBOARD: ['dashboard.ver'],
  CLIENTES: ['clientes.ver', 'clientes.gerenciar'],
  RH_CARGOS: ['cargos.ver', 'cargos.gerenciar'],
  RH_FUNCIONARIOS: ['funcionarios.ver', 'funcionarios.gerenciar', 'ferias.gerenciar', 'advertencias.gerenciar', 'pagamentos.gerenciar'],
  PONTO_REGISTRO: ['ponto.registrar'],
  PONTO_ADMINISTRACAO: ['ponto.administrar', 'ponto.feriados.gerenciar'],
  COMERCIAL: ['comercial.ver'],
  OPERACOES: ['operacoes.ver'],
  FINANCAS: ['financas.lancamentos.ver', 'financas.lancamentos.gerenciar'],
  RH: [], // legado morto, nunca atribuído a login novo, nunca concede nada
};

// Códigos do catálogo que NENHUM módulo concede — sob o sistema antigo eles eram gated só por
// `@Roles('ADMIN')`, sem nenhum `@RequireModule(...)` por trás (verificado controller a controller:
// `UsersController` e `custom-fields.controller.ts`). Um ADMIN sempre podia executá-los,
// independentemente do seu array de `modules`, então TODO perfil derivado de um ADMIN precisa
// recebê-los incondicionalmente. Computado a partir do mapa (nunca uma lista literal), pra
// continuar correto se MODULE_TO_PERMISSIONS ganhar/perder entradas no futuro.
export function getRoleOnlyGatedPermissionCodes(): string[] {
  const grantedBySomeModule = new Set<string>();
  for (const codes of Object.values(MODULE_TO_PERMISSIONS)) {
    for (const code of codes) grantedBySomeModule.add(code);
  }
  return PERMISSION_CATALOG.map((p) => p.code).filter((code) => !grantedBySomeModule.has(code));
}

// Antes chamado `LegacyUser` (vivia em scripts/backfill-profiles.ts) — renomeado porque deixou de
// ser exclusivo do backfill de empresas legadas: `UsersService.create()` usa a MESMA função pra
// derivar o perfil de um login novo em folha a partir de `role`/`modules`.
export interface ProfileSignatureInput {
  role: 'ADMIN' | 'EMPLOYEE';
  modules: string[];
  hasFullPontoAccess: boolean;
}

export interface ProfileSignature {
  name: string;
  isProtected: boolean;
  grants: { permissionCode: string; scope: Scope | null }[];
}

export function computeProfileSignature(user: ProfileSignatureInput): ProfileSignature {
  const permissionCodes = new Set<string>();
  for (const m of user.modules) {
    for (const code of MODULE_TO_PERMISSIONS[m] ?? []) permissionCodes.add(code);
  }

  const fullPonto = effectiveHasFullPontoAccess(user);

  if (user.role === 'ADMIN') {
    // Achado na revisão final da branch (18/09/2026): os dois ramos de ADMIN concediam o CATÁLOGO
    // INTEIRO, ignorando `user.modules` por completo — o oposto do objetivo declarado do backfill
    // (preservar o acesso efetivo de cada login bit a bit). Um ADMIN legado com
    // `modules: ['DASHBOARD']` (caso rotineiro, não hipotético) ganhava de presente Clientes,
    // Finanças, Ponto e tudo mais. O correto é a UNIÃO de (a) o que os módulos dele já concediam e
    // (b) o que era gated só por `@Roles('ADMIN')`, sem módulo nenhum por trás.
    for (const code of getRoleOnlyGatedPermissionCodes()) permissionCodes.add(code);
  }

  const grants = [...permissionCodes].map((code) => {
    const def = PERMISSION_CATALOG.find((p) => p.code === code)!;
    if (def.validScopes.length === 0) return { permissionCode: code, scope: null };
    if (code === 'ponto.administrar') {
      // `fullPonto` só é relevante pra ADMIN (effectiveHasFullPontoAccess é sempre false pra
      // EMPLOYEE, por definição). Pra EMPLOYEE, o scope aqui é só declarativo (a restrição real de
      // quem administra o ponto de quem vem de TimeManagementAuthService/managerId, não deste
      // flag) — por isso sempre EMPRESA nesse caso, nunca EQUIPE.
      const scope = user.role === 'ADMIN' && !fullPonto ? Scope.EQUIPE : Scope.EMPRESA;
      return { permissionCode: code, scope };
    }
    return { permissionCode: code, scope: Scope.EMPRESA };
  });

  if (user.role === 'ADMIN') {
    // Os dois nomes/isProtected seguem exatamente como antes desta correção — só o CONJUNTO de
    // códigos concedidos mudou, nunca a identidade do perfil nem a regra de escopo.
    return fullPonto
      ? { name: 'Administrador Geral', isProtected: true, grants }
      : { name: 'Administrador Geral (restrito ao Ponto)', isProtected: false, grants };
  }

  const sortedModules = [...user.modules].filter((m) => m !== 'RH').sort();
  return { name: `Legado: ${sortedModules.join(', ')}`, isProtected: false, grants };
}

/**
 * Resolve o `Profile` de uma assinatura dentro de uma empresa, criando-o só se ainda não existir.
 *
 * Substitui o `profileCache` em memória que o backfill mantinha por execução (achado M1 da revisão
 * final): aquele cache nascia vazio a cada rodada do script, então uma empresa cujo fundador já
 * tinha um "Administrador Geral" criado por `register()` ganhava um SEGUNDO perfil homônimo ao
 * backfillar um admin antigo sem `profileId`. Consultar o banco (um `findFirst` a mais por usuário —
 * irrelevante num script de cutover único) é ao mesmo tempo mais simples e mais correto, e serve
 * igualmente ao outro chamador novo, `UsersService.create()`.
 *
 * `Pick<Prisma.TransactionClient, 'profile'>` cobre os dois call sites sem `any`: ambos passam um
 * `tx` de dentro de um `$transaction` interativo.
 */
export async function getOrCreateProfileForSignature(
  tx: Pick<Prisma.TransactionClient, 'profile'>,
  companyId: string,
  signature: ProfileSignature,
): Promise<string> {
  const existing = await tx.profile.findFirst({ where: { companyId, name: signature.name } });
  if (existing) return existing.id;

  const created = await tx.profile.create({
    data: {
      companyId,
      name: signature.name,
      isProtected: signature.isProtected,
      permissions: {
        create: signature.grants.map((g) => ({ companyId, permissionCode: g.permissionCode, scope: g.scope })),
      },
    },
  });
  return created.id;
}
