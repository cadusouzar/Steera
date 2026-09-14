import { Employee } from '@prisma/client';
import { maskCpf } from '../common/cpf.util';

// `manager` só vem preenchido quando o caller fez o join (ver
// EmployeesService.create/update/findOne) — nos demais call sites (ex.:
// deactivate/reactivate) o objeto ainda tem `managerId` (campo real do
// modelo), só `managerName` fica null por falta do join.
type EmployeeWithOptionalManager = Employee & { manager?: { fullName: string } | null };

// Usado em listagens — sem CPF completo nem dados bancários.
export function toEmployeeListItem(employee: EmployeeWithOptionalManager) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    roleId: employee.roleId,
    managerId: employee.managerId,
    department: employee.department,
    contractType: employee.contractType,
    status: employee.status,
    cpfMasked: maskCpf(employee.cpf),
    baseValue: Number(employee.baseValue),
  };
}

// Usado no "Detalhes" do funcionário — view autorizada, campos completos.
export function toEmployeeDetail(employee: EmployeeWithOptionalManager) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    cpf: employee.cpf,
    roleId: employee.roleId,
    managerId: employee.managerId,
    managerName: employee.manager?.fullName ?? null,
    email: employee.email,
    phone: employee.phone,
    address: employee.address,
    contractType: employee.contractType,
    admissionDate: employee.admissionDate,
    terminationDate: employee.terminationDate,
    status: employee.status,
    department: employee.department,
    baseValue: Number(employee.baseValue),
    paymentDueDay: employee.paymentDueDay,
    payOnLastBusinessDay: employee.payOnLastBusinessDay,
    bankDetails: employee.bankDetails,
    salaryRecurrenceEnabled: employee.salaryRecurrenceEnabled,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}
