import { PlansService } from './plans.service';

describe('PlansService', () => {
  let service: PlansService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      company: { findUniqueOrThrow: jest.fn() },
      role: { count: jest.fn() },
      employee: { count: jest.fn() },
      user: { count: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new PlansService(prisma);
  });

  it('devolve o plano atual, o uso (3 contagens) e o catálogo completo (4 itens) pra uma empresa GRATIS', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
    prisma.role.count.mockResolvedValue(3);
    prisma.employee.count.mockResolvedValue(7);
    prisma.user.count.mockResolvedValue(1);

    const result = await service.getMyPlan('company-1', 'user-1');

    expect(result.current).toEqual({
      tier: 'GRATIS',
      label: 'Grátis',
      limits: { maxRoles: 5, maxEmployees: 10, maxEmployeeLogins: 2 },
    });
    expect(result.usage).toEqual({ roles: 3, employees: 7, employeeLogins: 1 });
    expect(result.catalog).toHaveLength(4);
    expect(result.catalog.map((p: any) => p.tier)).toEqual(['GRATIS', 'BASICO', 'PRO', 'EMPRESARIAL']);
    expect(result.catalog[0]).toEqual({
      tier: 'GRATIS',
      label: 'Grátis',
      priceLabel: 'R$ 0',
      modules: ['DASHBOARD', 'CLIENTES', 'RH_CARGOS', 'RH_FUNCIONARIOS'],
      features: [],
      limits: { maxRoles: 5, maxEmployees: 10, maxEmployeeLogins: 2 },
    });
  });

  it('consulta as três contagens com o filtro certo (só ativo) escopado por empresa', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'PRO' });
    prisma.role.count.mockResolvedValue(0);
    prisma.employee.count.mockResolvedValue(0);
    prisma.user.count.mockResolvedValue(0);

    await service.getMyPlan('company-2', 'user-2');

    expect(prisma.company.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'company-2' },
      select: { planTier: true },
    });
    expect(prisma.role.count).toHaveBeenCalledWith({ where: { companyId: 'company-2', active: true } });
    expect(prisma.employee.count).toHaveBeenCalledWith({ where: { companyId: 'company-2', status: 'ACTIVE' } });
    // Convite pendente (INVITED) conta no uso — mesma regra do teto aplicado em UsersService.create.
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { companyId: 'company-2', role: 'EMPLOYEE', status: { in: ['ACTIVE', 'INVITED'] } },
    });
  });

  it('devolve o plano atual/limites certos pra uma empresa EMPRESARIAL (tudo ilimitado)', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'EMPRESARIAL' });
    prisma.role.count.mockResolvedValue(40);
    prisma.employee.count.mockResolvedValue(300);
    prisma.user.count.mockResolvedValue(60);

    const result = await service.getMyPlan('company-3', 'user-3');

    expect(result.current).toEqual({
      tier: 'EMPRESARIAL',
      label: 'Empresarial',
      limits: { maxRoles: null, maxEmployees: null, maxEmployeeLogins: null },
    });
    expect(result.usage).toEqual({ roles: 40, employees: 300, employeeLogins: 60 });
  });

  // Quem gerencia a assinatura (27/09/2026).
  describe('canManageSubscription / billingContacts', () => {
    beforeEach(() => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
      prisma.role.count.mockResolvedValue(0);
      prisma.employee.count.mockResolvedValue(0);
      prisma.user.count.mockResolvedValue(0);
    });

    it('canManageSubscription = true quando o perfil do login concede assinatura.gerenciar', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      const result = await service.getMyPlan('company-1', 'user-1');
      expect(result.canManageSubscription).toBe(true);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'user-1',
          companyId: 'company-1',
          profile: { companyId: 'company-1', permissions: { some: { permissionCode: 'assinatura.gerenciar' } } },
        },
        select: { id: true },
      });
    });

    it('canManageSubscription = false quando o perfil não concede', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const result = await service.getMyPlan('company-1', 'user-1');
      expect(result.canManageSubscription).toBe(false);
    });

    it('billingContacts: logins ATIVOS da mesma empresa com assinatura.gerenciar, no máximo 3, por nome/e-mail', async () => {
      prisma.user.findMany.mockResolvedValue([
        { name: 'Ana', email: 'ana@a.com' },
        { name: null, email: 'dono@a.com' },
      ]);
      const result = await service.getMyPlan('company-1', 'user-1');
      expect(result.billingContacts).toEqual([
        { name: 'Ana', email: 'ana@a.com' },
        { name: null, email: 'dono@a.com' },
      ]);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          status: 'ACTIVE',
          profile: { companyId: 'company-1', permissions: { some: { permissionCode: 'assinatura.gerenciar' } } },
        },
        select: { name: true, email: true },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
        take: 3,
      });
    });
  });
});
