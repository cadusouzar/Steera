import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Vínculo login <-> ficha de funcionário (Employee), compartilhado entre o auto-vínculo
// (PATCH /auth/me/employee-link) e o vínculo feito por quem gerencia usuários
// (PATCH /companies/me/users/:id/employee).

export const SELF_LINK_DENIED_MESSAGE =
  'Seu acesso está ligado aos seus próprios dados, mas seu login ainda não tem uma ficha de funcionário. Peça a quem administra os acessos para vincular.';

// Achado 1 da revisão final (27/09/2026): o alcance (PROPRIO/EQUIPE/DEPARTAMENTO) é ancorado no
// Employee vinculado ao login. Se um login de alcance restrito pudesse escolher a própria ficha,
// escolheria também a própria raiz de alcance (ex.: vincular-se a um gerente e ver o time dele).
// Por isso o auto-vínculo só vale quando não amplia nada: o login gerencia usuários (já poderia
// vincular qualquer um) ou toda permissão com alcance que ele tem é EMPRESA. Função pura, também
// exposta no usuário público (`canSelfLinkEmployee`) pro frontend não duplicar a regra.
export function canSelfLinkEmployee(permissions: Record<string, string | null> | undefined | null): boolean {
  const grants = permissions ?? {};
  if ('usuarios.gerenciar' in grants) return true;
  return Object.values(grants).every((scope) => scope === null || scope === 'EMPRESA');
}

type EmployeeLinkPrisma = Pick<PrismaService, 'employee' | 'user'>;

// Employee (tabela de TENANT) e User (CENTRAL) lidos em consultas separadas, nunca dentro da mesma
// transação de tenant.
export async function assertEmployeeLinkable(
  prisma: EmployeeLinkPrisma,
  companyId: string,
  employeeId: string,
  options: { requireActive?: boolean } = {},
): Promise<void> {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } });
  if (!employee) throw new BadRequestException(`Funcionário ${employeeId} não encontrado nesta empresa`);
  if (options.requireActive && employee.status !== 'ACTIVE') {
    throw new BadRequestException('Funcionário inativo não pode ser vinculado a um login');
  }
  // User.employeeId é @unique — sem isso, dois logins acabariam "donos" do mesmo funcionário.
  const existingLogin = await prisma.user.findUnique({ where: { employeeId } });
  if (existingLogin) throw new BadRequestException('Este funcionário já possui um login vinculado');
}

// Grava o vínculo. `updateMany` com `employeeId: null` no filtro torna a checagem "login ainda sem
// vínculo" atômica: duas requisições simultâneas vinculando o MESMO login a fichas diferentes não
// passam as duas (a segunda encontra count 0 e recebe 400, nunca sobrescreve em silêncio). P2002 =
// corrida perdida no outro sentido (dois logins tentando a mesma ficha) — sem o catch, vazava 500 cru.
export async function saveEmployeeLink(
  prisma: Pick<PrismaService, 'user'>,
  userId: string,
  employeeId: string,
): Promise<void> {
  let count: number;
  try {
    ({ count } = await prisma.user.updateMany({ where: { id: userId, employeeId: null }, data: { employeeId } }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Este funcionário já está vinculado a outro login');
    }
    throw err;
  }
  if (count === 0) throw new BadRequestException('Este login já está vinculado a um funcionário');
}
