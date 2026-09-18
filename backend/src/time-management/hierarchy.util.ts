import { PrismaService } from '../prisma/prisma.service';

// Extraído de TimeManagementAuthService.getManageableEmployeeIds (achado ao desenhar o novo
// AuthorizationService: a mesma consulta — "subordinados diretos de um Employee, escopados por
// empresa" — precisa ser reaproveitada pelo resolvedor de escopo EQUIPE, sem reescrever ou
// duplicar a lógica de hierarquia já testada do Controle de Ponto).
export async function findDirectReportIds(
  prisma: Pick<PrismaService, 'employee'>,
  companyId: string,
  managerEmployeeId: string,
): Promise<string[]> {
  const reports = await prisma.employee.findMany({
    where: { managerId: managerEmployeeId, companyId },
    select: { id: true },
  });
  return reports.map((r) => r.id);
}
