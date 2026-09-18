import { findDirectReportIds } from './hierarchy.util';

describe('findDirectReportIds', () => {
  it('returns the ids of employees whose managerId matches, scoped by company', async () => {
    const prisma = { employee: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) } };
    const result = await findDirectReportIds(prisma as any, 'company-1', 'manager-1');
    expect(result).toEqual(['a', 'b']);
    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { managerId: 'manager-1', companyId: 'company-1' },
      select: { id: true },
    });
  });

  it('returns an empty array when there are no direct reports', async () => {
    const prisma = { employee: { findMany: jest.fn().mockResolvedValue([]) } };
    const result = await findDirectReportIds(prisma as any, 'company-1', 'manager-1');
    expect(result).toEqual([]);
  });
});
