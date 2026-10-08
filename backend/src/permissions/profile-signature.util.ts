import { AppModule as AppModuleEnum, Prisma, Scope } from '@prisma/client';
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
  OPERACOES: [
    'operacoes.ver', 'estoque.ver', 'estoque.produtos.gerenciar', 'estoque.movimentar', 'estoque.ajustar',
    'estoque.estornar', 'estoque.custos.ver', 'estoque.exportar', 'estoque.lixeira.gerenciar',
  ],
  FINANCAS: ['financas.lancamentos.ver', 'financas.lancamentos.gerenciar'],
  RH: [], // legado morto, nunca atribuído a login novo, nunca concede nada
};

// Direção OPOSTA de computeProfileSignature: dado o que um Perfil concede, deriva quais Módulos
// legados precisam continuar marcados pra `ModulesGuard` (ainda a trava real até a Fase 2b) não
// barrar quem tem a permissão de verdade. Um módulo entra na lista se o perfil concede QUALQUER
// uma das permissões daquele módulo — não é possível ser mais preciso enquanto o `ModulesGuard`
// não distinguir "ver" de "gerenciar" dentro do mesmo módulo (ver spec da Fase 2a, "Limitação
// temporária conhecida"). `RH` nunca é retornado (`MODULE_TO_PERMISSIONS.RH` é uma lista vazia).
export function deriveModulesFromGrants(grants: { permissionCode: string }[]): AppModuleEnum[] {
  const grantedCodes = new Set(grants.map((g) => g.permissionCode));
  const modules: AppModuleEnum[] = [];
  for (const [moduleId, codes] of Object.entries(MODULE_TO_PERMISSIONS)) {
    if (codes.length > 0 && codes.some((code) => grantedCodes.has(code))) {
      modules.push(moduleId as AppModuleEnum);
    }
  }
  return modules;
}

// `hasFullPontoAccess` deriva do scope concedido a `ponto.administrar`: EMPRESA = acesso total,
// EQUIPE (ou ausente) = restrito ao próprio time. Só é relevante pra ADMIN — `effectiveHasFullPontoAccess`
// já trata o lado de LEITURA desse valor pra EMPLOYEE (sempre `false`, por definição).
export function deriveHasFullPontoAccessFromGrants(
  grants: { permissionCode: string; scope: Scope | null }[],
): boolean {
  const pontoAdmin = grants.find((g) => g.permissionCode === 'ponto.administrar');
  return pontoAdmin?.scope === Scope.EMPRESA;
}

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

/** Teto de tentativas de desambiguação de nome de perfil — ver o laço em
 * `getOrCreateProfileForSignature`. Alto o bastante pra nunca ser atingido por uso real (seria
 * preciso uma empresa com 100 perfis homônimos de grants distintos), baixo o bastante pra falhar
 * rápido e alto se algo estiver errado. */
const MAX_PROFILE_NAME_ATTEMPTS = 100;

/** Compara dois conjuntos de concessões ignorando a ordem — um `Profile` só é "o mesmo perfil" de
 * uma assinatura se conceder EXATAMENTE os mesmos pares `permissionCode`+`scope`. */
function grantsMatch(
  existingGrants: { permissionCode: string; scope: Scope | null }[],
  signatureGrants: ProfileSignature['grants'],
): boolean {
  if (existingGrants.length !== signatureGrants.length) return false;
  const key = (g: { permissionCode: string; scope: Scope | null }) => `${g.permissionCode}:${g.scope ?? 'null'}`;
  const existingSet = new Set(existingGrants.map(key));
  return signatureGrants.every((g) => existingSet.has(key(g)));
}

/**
 * Resolve o `Profile` de uma assinatura dentro de uma empresa, criando-o só se ainda não existir um
 * perfil que conceda EXATAMENTE o mesmo conjunto de permissões.
 *
 * Substitui o `profileCache` em memória que o backfill mantinha por execução (achado M1 da revisão
 * final): aquele cache nascia vazio a cada rodada do script, então uma empresa cujo fundador já
 * tinha um "Administrador Geral" criado por `register()` ganhava um SEGUNDO perfil homônimo ao
 * backfillar um admin antigo sem `profileId`. Consultar o banco (duas consultas a mais por usuário —
 * irrelevante num script de cutover único) é ao mesmo tempo mais simples e mais correto, e serve
 * igualmente ao outro chamador novo, `UsersService.create()`.
 *
 * **Por que a checagem de grants, e não só o nome (2ª rodada de fixes da revisão final):** a versão
 * anterior reaproveitava QUALQUER perfil com o mesmo `(companyId, name)`, sem olhar o que ele de
 * fato concedia. Como todo login novo nasce com `hasFullPontoAccess: true` (o `@default(true)` da
 * coluna — `CreateUserDto` não tem campo pra outra coisa), `computeProfileSignature` sempre cai no
 * ramo `fullPonto` pra um ADMIN, que sempre produz o nome `'Administrador Geral'`, INDEPENDENTE dos
 * `modules` dele. Resultado: um segundo admin criado com `modules: ['DASHBOARD']` computava
 * corretamente um `grants` restrito e em seguida era anexado ao perfil homônimo do FUNDADOR
 * (catálogo inteiro, vindo de `register()`), jogando fora o conjunto restrito e ganhando acesso
 * total em silêncio — inflação de privilégio no DADO do perfil. Ainda não explorável na Fase 1
 * (nada autoriza por perfil ainda), mas a Fase 2 vai ler exatamente este dado como verdade.
 *
 * Quando o nome colide mas os grants diferem, o perfil novo nasce com um sufixo (`... (2)`,
 * `... (3)`, ...) até achar um nome livre OU um homônimo cujos grants batem — assim um TERCEIRO
 * admin com a mesma assinatura restrita reaproveita o perfil já desambiguado em vez de criar mais um.
 *
 * `Pick<Prisma.TransactionClient, 'profile' | 'profilePermission'>` cobre os dois call sites sem
 * `any`: ambos passam um `tx` de dentro de um `$transaction` interativo.
 */
export async function getOrCreateProfileForSignature(
  tx: Pick<Prisma.TransactionClient, 'profile' | 'profilePermission'>,
  companyId: string,
  signature: ProfileSignature,
): Promise<string> {
  let candidateName = signature.name;
  let suffix = 1;
  let found = false;

  // Teto explícito em vez de `for(;;)`: o laço só termina porque `findFirst` filtra pelo nome
  // candidato e um nome novo acaba não existindo — uma garantia do banco, não do código deste
  // arquivo. Um teto barato transforma qualquer cenário patológico (ou um mock mal feito num teste)
  // num erro claro em vez de um laço infinito silencioso.
  for (; suffix <= MAX_PROFILE_NAME_ATTEMPTS; suffix += 1) {
    candidateName = suffix === 1 ? signature.name : `${signature.name} (${suffix})`;
    const existing = await tx.profile.findFirst({ where: { companyId, name: candidateName } });
    if (!existing) {
      found = true; // nome livre — cria abaixo com este nome
      break;
    }
    const existingGrants = await tx.profilePermission.findMany({ where: { profileId: existing.id } });
    if (grantsMatch(existingGrants, signature.grants)) return existing.id; // mesmo perfil de fato
    // Nome colidiu, mas o CONJUNTO de grants difere — tenta o próximo sufixo.
  }

  if (!found) {
    throw new Error(
      `Não foi possível resolver um nome livre para o perfil "${signature.name}" na empresa ${companyId} ` +
        `após ${MAX_PROFILE_NAME_ATTEMPTS} tentativas`,
    );
  }

  const created = await tx.profile.create({
    data: {
      companyId,
      name: candidateName,
      isProtected: signature.isProtected,
      permissions: {
        create: signature.grants.map((g) => ({ companyId, permissionCode: g.permissionCode, scope: g.scope })),
      },
    },
  });
  return created.id;
}
