import { Employee } from '@prisma/client';
import { maskCpf } from '../common/cpf.util';

// Usado em listagens — sem CPF completo nem dados bancários.
export function toEmployeeListItem(employee: Employee) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    roleId: employee.roleId,
    department: employee.department,
    contractType: employee.contractType,
    status: employee.status,
    cpfMasked: maskCpf(employee.cpf),
    baseValue: Number(employee.baseValue),
  };
}

// Usado no "Detalhes" do funcionário — view autorizada, campos completos.
export function toEmployeeDetail(employee: Employee) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    cpf: employee.cpf,
    roleId: employee.roleId,
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
