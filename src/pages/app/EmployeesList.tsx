import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Filter, X, FileText, AlertCircle, Calendar, User, Briefcase, DollarSign, Activity, ChevronRight, Edit2, Save, MapPin, Phone, Mail, Building, CreditCard, ChevronDown, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import CustomSelect from '../../components/CustomSelect';
import FinanceAndVacationModal from '../../components/FinanceAndVacationModal';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface Warning {
  id: string;
  date: string;
  reason: string;
}

interface Payment {
  id: string;
  month: string;
  year: number;
  status: 'paid' | 'pending' | 'overdue';
  amount: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  salary: string;
  status: 'active' | 'inactive';
  cpf: string;
  admissionDate: string;
  department: string;
  warnings: Warning[];
  email?: string;
  phone?: string;
  address?: string;
  contractType?: string;
  paymentDay?: string;
  bankDetails?: string;
  payments: Payment[];
  vacation: {
    daysTaken: number;
    history: { startDate: string; endDate: string }[];
  };
  salaryRecurrence?: boolean;
}

const initialEmployees: Employee[] = [
  {
    id: '1', name: 'João Silva', role: 'Desenvolvedor Front-end', salary: 'R$ 7.500', status: 'active',
    cpf: '111.222.333-44', admissionDate: '2023-01-15', department: 'Tecnologia',
    email: 'joao.silva@exemplo.com', phone: '(11) 99999-9999', address: 'Rua das Flores, 123, São Paulo - SP',
    contractType: 'clt', paymentDay: '5', bankDetails: 'Banco Itaú, Ag 1234, CC 56789-0', salaryRecurrence: true,
    warnings: [],
    payments: [
      { id: 'p1', month: 'maio', year: 2026, status: 'paid', amount: 'R$ 7.500' },
      { id: 'p2', month: 'junho', year: 2026, status: 'pending', amount: 'R$ 7.500' }
    ],
    vacation: { daysTaken: 0, history: [] }
  },
  {
    id: '2', name: 'Maria Santos', role: 'Analista de RH', salary: 'R$ 4.200', status: 'active',
    cpf: '222.333.444-55', admissionDate: '2022-05-10', department: 'Recursos Humanos',
    email: 'maria.santos@exemplo.com', phone: '(11) 88888-8888', address: 'Av. Paulista, 1000, São Paulo - SP',
    contractType: 'clt', paymentDay: '5', bankDetails: 'Banco Bradesco, Ag 4321, CC 98765-4', salaryRecurrence: true,
    warnings: [{ id: 'w1', date: '2023-11-20', reason: 'Atraso injustificado' }],
    payments: [
      { id: 'p3', month: 'maio', year: 2026, status: 'paid', amount: 'R$ 4.200' },
      { id: 'p4', month: 'junho', year: 2026, status: 'overdue', amount: 'R$ 4.200' }
    ],
    vacation: { daysTaken: 15, history: [{ startDate: '2024-01-10', endDate: '2024-01-25' }] }
  },
  {
    id: '3', name: 'Pedro Almeida', role: 'Gerente de Vendas', salary: 'R$ 9.000', status: 'inactive',
    cpf: '333.444.555-66', admissionDate: '2021-08-01', department: 'Comercial',
    email: 'pedro.almeida@exemplo.com', phone: '(11) 77777-7777', address: 'Rua Augusta, 500, São Paulo - SP',
    contractType: 'pj', paymentDay: '15', bankDetails: 'Nubank, Ag 0001, CC 123456-7', salaryRecurrence: false,
    warnings: [],
    payments: [
      { id: 'p5', month: 'maio', year: 2026, status: 'paid', amount: 'R$ 9.000' }
    ],
    vacation: { daysTaken: 0, history: [] }
  },
];

const EmployeesList = () => {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [searchQuery, setSearchQuery] = useState('');

  // Drawer state
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Finance Modal state
  const [financeEmployee, setFinanceEmployee] = useState<Employee | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});

  // Warning modal state
  const [warningModalOpen, setWarningModalOpen] = useState(false);
  const [warningDate, setWarningDate] = useState('');
  const [warningReason, setWarningReason] = useState('');

  useEscapeKey(() => {
    setSelectedEmployee(null);
    setFinanceEmployee(null);
    setWarningModalOpen(false);
  });

  // Prevent background scrolling when Drawer/Modal is open
  useEffect(() => {
    if (selectedEmployee || warningModalOpen || financeEmployee) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedEmployee, warningModalOpen, financeEmployee]);

  // Reset editing mode when employee changes
  useEffect(() => {
    if (!selectedEmployee) {
      setIsEditing(false);
    }
  }, [selectedEmployee]);

  const filteredEmployees = employees.filter(emp => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return emp.name.toLowerCase().includes(lowerQuery) ||
      emp.role.toLowerCase().includes(lowerQuery) ||
      emp.department.toLowerCase().includes(lowerQuery);
  });

  const handleEditClick = () => {
    setEditForm(selectedEmployee!);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = () => {
    if (!editForm.name || !editForm.cpf || !editForm.role) return; // basic validation
    const updatedEmployee = editForm as Employee;

    setEmployees(employees.map(emp => emp.id === updatedEmployee.id ? updatedEmployee : emp));
    setSelectedEmployee(null);
    setIsEditing(false);
  };

  const handleMarkAsPaid = (paymentId: string) => {
    if (!financeEmployee) return;

    const updatedEmployees = employees.map(emp => {
      if (emp.id === financeEmployee.id) {
        const updatedPayments = emp.payments.map(p => p.id === paymentId ? { ...p, status: 'paid' as const } : p);
        const updatedEmp = { ...emp, payments: updatedPayments };
        setFinanceEmployee(updatedEmp);
        return updatedEmp;
      }
      return emp;
    });
    setEmployees(updatedEmployees);
  };

  const handleScheduleVacation = (days: number) => {
    if (!financeEmployee) return;

    const updatedEmployees = employees.map(emp => {
      if (emp.id === financeEmployee.id) {
        const updatedEmp = {
          ...emp,
          vacation: {
            daysTaken: emp.vacation.daysTaken + days,
            history: [
              ...emp.vacation.history,
              { startDate: new Date().toISOString(), endDate: new Date(Date.now() + days * 86400000).toISOString() }
            ]
          }
        };
        setFinanceEmployee(updatedEmp);
        return updatedEmp;
      }
      return emp;
    });
    setEmployees(updatedEmployees);
  };

  const openWarning = () => {
    setWarningDate(new Date().toISOString().split('T')[0]); // default to today
    setWarningReason('');
    setWarningModalOpen(true);
  };

  const handleAddWarning = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !warningDate || !warningReason) return;

    const newWarning: Warning = {
      id: crypto.randomUUID(),
      date: warningDate,
      reason: warningReason
    };

    setEmployees(employees.map(emp => {
      if (emp.id === selectedEmployee.id) {
        return { ...emp, warnings: [...emp.warnings, newWarning] };
      }
      return emp;
    }));

    setSelectedEmployee({
      ...selectedEmployee,
      warnings: [...selectedEmployee.warnings, newWarning]
    });

    setWarningModalOpen(false);
  };

  return (
    <div className="p-6 md:p-8 relative">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="max-w-6xl mx-auto"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight">Gestão de Funcionários</h1>
            <p className="text-muted text-sm mt-1">Gerencie a base de pessoas da sua empresa.</p>
          </div>
          <Link
            to="/app/funcionarios/novo"
            className="bg-primary hover:bg-primary/90 text-white px-6 py-3.5 rounded-xl font-medium transition-colors shadow-lg shadow-primary/20 flex items-center gap-2 w-full md:w-auto justify-center whitespace-nowrap"
          >
            <Plus size={18} />
            Novo Funcionário
          </Link>
        </div>

        {/* Action Bar */}
        <div className="glass-panel p-2 rounded-2xl border border-border/60 mb-8 flex flex-col md:flex-row items-center gap-4 shadow-sm">
          <div className="flex-1 flex items-center px-4 w-full">
            <Search size={20} className="text-primary/70 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome, cargo ou departamento..."
              className="w-full bg-transparent border-none px-4 py-3 text-base text-foreground placeholder:text-muted focus:outline-none focus:ring-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-1.5 rounded-full hover:bg-secondary/80 text-muted hover:text-foreground transition-colors shrink-0"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="hidden md:block w-px h-8 bg-border/50"></div>
          <button className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium hover:bg-secondary/80 rounded-xl transition-colors text-foreground whitespace-nowrap mr-2">
            <Filter size={18} className="text-muted" />
            Filtros
          </button>
        </div>

        {/* Data Grid */}
        <div className="glass-panel rounded-3xl border border-border/60 overflow-hidden shadow-sm">
          {filteredEmployees.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="border-b-2 border-border/60 bg-secondary/10">
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Nome</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Cargo</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Departamento</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Salário</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider">Status</th>
                    <th className="px-8 py-5 text-sm font-heading font-semibold text-foreground/90 uppercase tracking-wider text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <AnimatePresence>
                    {filteredEmployees.map((emp, index) => (
                      <motion.tr
                        key={emp.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2, delay: index * 0.03 }}
                        onClick={() => setFinanceEmployee(emp)}
                        onDoubleClick={() => setSelectedEmployee(emp)}
                        className="hover:bg-secondary/40 transition-colors group cursor-pointer"
                      >
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-sm shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                              {emp.name.charAt(0)}
                            </div>
                            <span className="text-base font-heading font-medium text-foreground group-hover:text-primary transition-colors">
                              {emp.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-muted font-medium">{emp.role}</td>
                        <td className="px-8 py-6 text-muted font-medium">{emp.department}</td>
                        <td className="px-8 py-6">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-sm font-bold text-foreground">{emp.salary}</span>
                            {emp.salaryRecurrence !== false ? (
                              <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full w-fit">
                                <RefreshCw size={10} /> Recorrente
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-muted bg-secondary px-2 py-0.5 rounded-full w-fit border border-border/50">
                                <X size={10} /> Manual
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          {emp.status === 'active' ? (
                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 shadow-sm">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                              ATIVO
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-secondary text-foreground/60 border border-border/60 shadow-sm">
                              <div className="w-1.5 h-1.5 rounded-full bg-foreground/40"></div>
                              INATIVO
                            </span>
                          )}
                        </td>
                        <td className="px-8 py-6 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEmployee(emp);
                            }}
                            className="inline-flex items-center gap-1 text-sm font-medium text-muted group-hover:text-primary transition-colors hover:bg-secondary px-4 py-2 rounded-xl"
                          >
                            Detalhes
                            <ChevronRight size={16} />
                          </button>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-24 px-6 text-center flex flex-col items-center justify-center">
              <div className="w-20 h-20 bg-secondary/50 rounded-[2rem] flex items-center justify-center text-muted mb-6 rotate-12 shadow-sm border border-border/50">
                <Search size={40} />
              </div>
              <h3 className="text-xl font-heading font-bold text-foreground mb-2">Nenhum funcionário encontrado</h3>
              <p className="text-muted max-w-md text-base">
                Não encontramos resultados para "{searchQuery}".
              </p>
            </div>
          )}
        </div>
      </motion.div>

      {/* PORTALS FOR DRAWER AND MODAL */}

      {/* 1. Drawer: Detalhes do Funcionário */}
      {selectedEmployee && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedEmployee(null)}
              className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex justify-end pointer-events-none">
              <motion.div
                initial={{ x: "100%", opacity: 0.5 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0.5 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="bg-background border-l border-border/60 w-full max-w-lg h-full shadow-2xl pointer-events-auto flex flex-col"
              >
                {/* Drawer Header */}
                <div className="p-6 md:p-8 border-b border-border/40 flex flex-col gap-2 relative overflow-hidden shrink-0">
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
                  <div className="flex items-start justify-between mt-2">
                    <div className="flex items-center gap-4 flex-1 mr-4">
                      <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-2xl shadow-sm shrink-0">
                        {isEditing && editForm.name ? editForm.name.charAt(0) : selectedEmployee.name.charAt(0)}
                      </div>
                      <div className="flex-1 w-full min-w-0">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.name || ''}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full bg-background border border-border/80 rounded-lg px-3 py-1.5 text-2xl font-heading font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                            placeholder="Nome Completo"
                          />
                        ) : (
                          <h2 className="text-2xl font-heading font-bold text-foreground truncate">
                            {selectedEmployee.name}
                          </h2>
                        )}

                        {isEditing ? (
                          <div className="mt-2">
                            <input
                              type="text"
                              value={editForm.role || ''}
                              onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                              className="w-full bg-background border border-border/80 rounded-lg px-3 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                              placeholder="Cargo"
                            />
                          </div>
                        ) : (
                          <span className="text-muted text-sm font-medium flex items-center gap-1.5 mt-1 truncate">
                            <Briefcase size={14} className="text-primary/70 shrink-0" /> {selectedEmployee.role}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isEditing && (
                        <button
                          onClick={handleEditClick}
                          className="p-2 text-primary hover:text-primary bg-primary/10 hover:bg-primary/20 rounded-full transition-colors flex items-center justify-center"
                          title="Editar Funcionário"
                        >
                          <Edit2 size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedEmployee(null)}
                        className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Drawer Body */}
                <div className="p-6 md:p-8 flex-1 overflow-y-auto custom-scrollbar">
                  <div className="space-y-8 pb-10">

                    {/* Status Section */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-secondary/20 rounded-2xl border border-border/40 gap-4">
                      <div>
                        <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Status Atual</p>
                        <p className="text-sm font-medium text-foreground">Condição do vínculo</p>
                      </div>

                      {isEditing ? (
                        <div className="w-40">
                          <CustomSelect
                            value={editForm.status || 'active'}
                            onChange={(val) => setEditForm({ ...editForm, status: val as 'active' | 'inactive' })}
                            options={[
                              { value: 'active', label: 'ATIVO' },
                              { value: 'inactive', label: 'INATIVO' }
                            ]}
                            className="!py-2 !px-4 !rounded-xl font-bold"
                          />
                        </div>
                      ) : (
                        selectedEmployee.status === 'active' ? (
                          <span className="px-4 py-2 rounded-full text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 whitespace-nowrap">
                            ATIVO
                          </span>
                        ) : (
                          <span className="px-4 py-2 rounded-full text-xs font-bold bg-secondary text-foreground/60 border border-border/60 whitespace-nowrap">
                            INATIVO
                          </span>
                        )
                      )}
                    </div>

                    {!isEditing ? (
                      <>
                        {/* VIEW MODE */}

                        {/* Infos Card - Dados Pessoais */}
                        <div>
                          <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
                            <User size={14} /> Dados Pessoais
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">CPF</p>
                              <p className="text-sm font-medium text-foreground">{selectedEmployee.cpf || 'Não informado'}</p>
                            </div>
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">E-mail Pessoal</p>
                              <p className="text-sm font-medium text-foreground truncate" title={selectedEmployee.email}>{selectedEmployee.email || 'Não informado'}</p>
                            </div>
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Telefone / WhatsApp</p>
                              <p className="text-sm font-medium text-foreground">{selectedEmployee.phone || 'Não informado'}</p>
                            </div>
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Endereço</p>
                              <p className="text-sm font-medium text-foreground truncate" title={selectedEmployee.address}>{selectedEmployee.address || 'Não informado'}</p>
                            </div>
                          </div>
                        </div>

                        {/* Infos Card - Vínculo */}
                        <div>
                          <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2 mt-6">
                            <Briefcase size={14} /> Cargo & Vínculo
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Departamento</p>
                              <p className="text-sm font-medium text-foreground">{selectedEmployee.department || 'Não informado'}</p>
                            </div>
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Tipo de Contrato</p>
                              <p className="text-sm font-medium text-foreground uppercase">{selectedEmployee.contractType || 'Não informado'}</p>
                            </div>
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors sm:col-span-2">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Admissão</p>
                              <p className="text-sm font-medium text-foreground">
                                {new Date(selectedEmployee.admissionDate).toLocaleDateString('pt-BR')}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Infos Card - Financeiro */}
                        <div>
                          <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2 mt-6">
                            <DollarSign size={14} /> Financeiro
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Salário Base</p>
                              <p className="text-sm font-medium text-foreground">{selectedEmployee.salary || 'Não informado'}</p>
                            </div>
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Dia de Pagamento</p>
                              <p className="text-sm font-medium text-foreground">
                                {selectedEmployee.paymentDay === 'last' ? 'Último dia útil' : (selectedEmployee.paymentDay ? `Dia ${selectedEmployee.paymentDay}` : 'Não informado')}
                              </p>
                            </div>
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors">
                              <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Dados Bancários</p>
                              <p className="text-sm font-medium text-foreground">{selectedEmployee.bankDetails || 'Não informado'}</p>
                            </div>
                            <div className="bg-background border border-border/60 rounded-xl p-4 shadow-sm hover:border-primary/30 transition-colors flex items-center justify-between">
                              <div>
                                <p className="text-[10px] text-muted uppercase font-bold tracking-wider mb-1">Recorrência Automática</p>
                                <p className="text-sm font-medium text-foreground">
                                  {selectedEmployee.salaryRecurrence !== false ? 'Ativada (Mensal)' : 'Desativada'}
                                </p>
                              </div>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${selectedEmployee.salaryRecurrence !== false ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted'}`}>
                                <DollarSign size={16} />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Advertências */}
                        <div>
                          <div className="flex items-center justify-between mb-4 mt-6">
                            <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                              <AlertCircle size={16} className="text-orange-500" />
                              Histórico de Advertências
                            </h4>
                            <button
                              onClick={openWarning}
                              className="text-xs font-bold text-red-500 hover:text-red-600 bg-red-500/10 hover:bg-red-500/20 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              + Adicionar
                            </button>
                          </div>

                          {selectedEmployee.warnings.length > 0 ? (
                            <div className="space-y-3">
                              {selectedEmployee.warnings.map(warning => (
                                <div key={warning.id} className="bg-orange-500/5 border border-orange-500/20 rounded-2xl p-4 flex gap-4">
                                  <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                                    <AlertCircle size={20} className="text-orange-500" />
                                  </div>
                                  <div>
                                    <p className="font-bold text-foreground text-sm">Advertência Registrada</p>
                                    <p className="text-xs text-muted mt-1">{new Date(warning.date).toLocaleDateString('pt-BR')}</p>
                                    <p className="text-sm text-foreground/80 mt-2 bg-background p-3 rounded-xl border border-border/50 shadow-sm leading-relaxed">
                                      {warning.reason}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-10 bg-background border border-border/40 border-dashed rounded-2xl">
                              <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center mx-auto mb-3">
                                <Activity size={20} />
                              </div>
                              <p className="text-sm font-bold text-foreground">Nenhuma advertência</p>
                              <p className="text-xs text-muted mt-1">Este funcionário possui um histórico limpo.</p>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* EDIT MODE FORM */}
                        <div className="space-y-6">

                          {/* Dados Pessoais */}
                          <div className="bg-secondary/10 p-5 rounded-2xl border border-border/40">
                            <h4 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                              <User size={16} className="text-primary/70" /> Dados Pessoais
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">CPF</label>
                                <input type="text" value={editForm.cpf || ''} onChange={(e) => setEditForm({ ...editForm, cpf: e.target.value })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">E-mail Pessoal</label>
                                <input type="email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Telefone / WhatsApp</label>
                                <input type="text" value={editForm.phone || ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div className="sm:col-span-2">
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Endereço Completo</label>
                                <input type="text" value={editForm.address || ''} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                            </div>
                          </div>

                          {/* Cargo & Vínculo */}
                          <div className="bg-secondary/10 p-5 rounded-2xl border border-border/40">
                            <h4 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                              <Briefcase size={16} className="text-primary/70" /> Cargo & Vínculo
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="sm:col-span-2">
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Departamento</label>
                                <input type="text" value={editForm.department || ''} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Data de Admissão</label>
                                <input type="date" value={editForm.admissionDate || ''} onChange={(e) => setEditForm({ ...editForm, admissionDate: e.target.value })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Tipo de Contrato</label>
                                <CustomSelect
                                  value={editForm.contractType || ''}
                                  onChange={(val) => setEditForm({ ...editForm, contractType: val })}
                                  options={[
                                    { value: 'clt', label: 'CLT' },
                                    { value: 'pj', label: 'PJ' },
                                    { value: 'estagio', label: 'Estágio' }
                                  ]}
                                  className="!py-2.5 !px-3"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Financeiro */}
                          <div className="bg-secondary/10 p-5 rounded-2xl border border-border/40">
                            <h4 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                              <DollarSign size={16} className="text-primary/70" /> Financeiro
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Salário Base</label>
                                <input type="text" value={editForm.salary || ''} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="R$ 0,00" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Dia de Pagamento</label>
                                <CustomSelect
                                  value={editForm.paymentDay || ''}
                                  onChange={(val) => setEditForm({ ...editForm, paymentDay: val })}
                                  options={[
                                    { value: '5', label: 'Dia 5 útil' },
                                    { value: '15', label: 'Dia 15' },
                                    { value: '20', label: 'Dia 20' },
                                    { value: 'last', label: 'Último dia útil' }
                                  ]}
                                  className="!py-2.5 !px-3"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Dados Bancários (Opcional)</label>
                                <input type="text" value={editForm.bankDetails || ''} onChange={(e) => setEditForm({ ...editForm, bankDetails: e.target.value })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="Banco, Agência, Conta PIX..." />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Recorrência Automática</label>
                                <CustomSelect
                                  value={editForm.salaryRecurrence !== false ? 'yes' : 'no'}
                                  onChange={(val) => setEditForm({ ...editForm, salaryRecurrence: val === 'yes' })}
                                  options={[
                                    { value: 'yes', label: 'Sim (Gerar despesa mensal)' },
                                    { value: 'no', label: 'Não' }
                                  ]}
                                  className="!py-2.5 !px-3"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Edit Actions Footer */}
                <AnimatePresence>
                  {isEditing && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      className="p-6 md:p-8 border-t border-border/40 bg-background/80 backdrop-blur-md shrink-0 flex gap-3"
                    >
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        className="flex-1 py-3.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                      >
                        <Save size={18} />
                        Salvar Alterações
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

      {/* 2. Modal: Nova Advertência */}
      {warningModalOpen && selectedEmployee && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setWarningModalOpen(false)}
              className="fixed inset-0 z-[110] bg-background/80 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="bg-background border border-red-500/20 rounded-3xl p-6 md:p-8 w-full max-w-md shadow-2xl pointer-events-auto relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-red-500 to-orange-500 opacity-80" />
                <div className="flex items-center justify-between mb-8 mt-2">
                  <h2 className="text-2xl font-heading font-bold text-red-500 flex items-center gap-2">
                    <AlertCircle size={24} />
                    Nova Advertência
                  </h2>
                  <button
                    onClick={() => setWarningModalOpen(false)}
                    className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form onSubmit={handleAddWarning} className="space-y-6">
                  <div className="bg-secondary/20 border border-border/40 p-4 rounded-2xl flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
                      {selectedEmployee.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-base font-bold text-foreground">{selectedEmployee.name}</p>
                      <p className="text-sm text-muted font-medium">{selectedEmployee.role}</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-foreground/90 mb-2">
                      Data da Ocorrência <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      required
                      value={warningDate}
                      onChange={(e) => setWarningDate(e.target.value)}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-all shadow-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-foreground/90 mb-2">
                      Motivo / Descrição <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      required
                      value={warningReason}
                      onChange={(e) => setWarningReason(e.target.value)}
                      placeholder="Descreva o motivo da advertência de forma clara..."
                      rows={4}
                      className="w-full bg-background border border-border/80 rounded-xl px-4 py-4 text-base text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-red-500/50 transition-all shadow-sm resize-none"
                    ></textarea>
                  </div>

                  <div className="pt-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setWarningModalOpen(false)}
                      className="flex-1 py-4 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-base"
                    >
                      Cancelar
                    </button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={!warningDate || !warningReason.trim()}
                      className="flex-1 py-4 bg-red-500 hover:bg-red-600 text-white rounded-xl text-base font-bold transition-colors shadow-lg shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Registrar
                    </motion.button>
                  </div>
                </form>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

      {/* 3. Modal: Gestão Financeira e Férias */}
      {financeEmployee && createPortal(
        <FinanceAndVacationModal
          employee={financeEmployee}
          onClose={() => setFinanceEmployee(null)}
          onMarkAsPaid={handleMarkAsPaid}
          onScheduleVacation={handleScheduleVacation}
        />,
        document.body
      )}

    </div>
  );
};

export default EmployeesList;
