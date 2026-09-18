import { Employee, Prisma } from '@prisma/client';
import { toEmployeeDetail, toEmployeeListItem } from './employee-response.mapper';

// Fixture no formato do modelo Employee do Prisma (mesmos campos usados em
// employees.service.spec.ts), com CPF real e dados bancários preenchidos —
// exatamente o cenário que a listagem NÃO pode vazar (LGPD).
const employee: Employee = {
  id: 'employee-1',
  companyId: 'company-1',
  roleId: 'role-1',
  fullName: 'João Silva',
  cpf: '11122233344',
  email: 'joao@example.com',
  phone: '11999999999',
  address: 'Rua A, 100',
  contractType: 'CLT' as Employee['contractType'],
  admissionDate: new Date('2026-01-01T00:00:00Z'),
  terminationDate: null,
  status: 'ACTIVE' as Employee['status'],
  department: 'Tecnologia',
  baseValue: new Prisma.Decimal(5000),
  paymentDueDay: 5,
  payOnLastBusinessDay: false,
  bankDetails: 'Banco 001 / Ag 1234 / CC 56789-0',
  salaryRecurrenceEnabled: true,
  managerId: null,
  departmentId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('employee-response.mapper', () => {
  it('toEmployeeListItem never exposes the full CPF nor bankDetails', () => {
    const item = toEmployeeListItem(employee);

    expect(Object.keys(item)).not.toContain('cpf');
    expect(Object.keys(item)).not.toContain('bankDetails');
    expect(item.cpfMasked).not.toContain('11122233344');
    expect(JSON.stringify(item)).not.toContain('11122233344');
    expect(JSON.stringify(item)).not.toContain('56789-0');
  });

  it('toEmployeeDetail exposes the full CPF and bankDetails (authorized full-access view)', () => {
    const detail = toEmployeeDetail(employee);

    expect(detail.cpf).toBe('11122233344');
    expect(detail.bankDetails).toBe('Banco 001 / Ag 1234 / CC 56789-0');
  });
});
