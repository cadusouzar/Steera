import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, Filter, X, AlertCircle, Briefcase, ChevronRight, Edit2, Save, DollarSign, Loader2, Ban, RotateCcw, User, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import CustomSelect from '../../components/CustomSelect';
import FinanceAndVacationModal from '../../components/FinanceAndVacationModal';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import * as api from '../../lib/api';
import type { EmployeeDetail, EmployeeListItem, EmployeeWarning, Role } from '../../lib/api';

export interface Employee extends EmployeeDetail {
  warnings: EmployeeWarning[];
}

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

// Formata uma data-only string (ex.: "2026-09-01" ou "2026-09-01T00:00:00.000Z") sem
// passar por `Date`/`toLocaleDateString`, que converteriam para o fuso horário local do
// navegador e podem exibir o dia anterior em fusos com offset negativo (ex.: Brasil, UTC-3).
const formatDateOnly = (dateStr: string) => {
  const [year, month, day] = dateStr.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
};

const EmployeesList = () => {
  const [employeeItems, setEmployeeItems] = useState<EmployeeListItem[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Drawer state
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isDrawerLoading, setIsDrawerLoading] = useState(false);

  // Finance Modal state
  const [financeEmployeeId, setFinanceEmployeeId] = useState<string | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});

  // Warning modal state
  const [warningModalOpen, setWarningModalOpen] = useState(false);
  const [warningDate, setWarningDate] = useState('');
  const [warningReason, setWarningReason] = useState('');

  const roleNameById = (roleId: string) => roles.find(r => r.id === roleId)?.name ?? '(cargo inativo)';

  const loadList = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [items, activeRoles] = await Promise.all([api.listEmployees(), api.listActiveRoles()]);
      setEmployeeItems(items);
      setRoles(activeRoles);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os funcionários.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openEmployeeDetail = async (id: string) => {
    setIsDrawerLoading(true);
    setActionError(null);
    try {
      const [detail, warnings] = await Promise.all([api.getEmployee(id), api.listWarnings(id)]);
      setSelectedEmployee({ ...detail, warnings });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível carregar o funcionário.');
    } finally {
      setIsDrawerLoading(false);
    }
  };

  // Fecha o drawer de detalhes a partir de qualquer estado (carregando, com erro ou com dados
  // já carregados) — usado pelo backdrop, pelo botão de fechar e pelo Escape.
  const closeDrawer = () => {
    setSelectedEmployee(null);
    setIsDrawerLoading(false);
    setActionError(null);
  };

  useEscapeKey(() => {
    closeDrawer();
    setFinanceEmployeeId(null);
    setWarningModalOpen(false);
  });

  useEffect(() => {
    if (selectedEmployee || warningModalOpen || financeEmployeeId || isDrawerLoading) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedEmployee, warningModalOpen, financeEmployeeId, isDrawerLoading]);

  useEffect(() => {
    if (!selectedEmployee) setIsEditing(false);
  }, [selectedEmployee]);

  const filteredEmployees = employeeItems.filter(emp => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return emp.fullName.toLowerCase().includes(lowerQuery) ||
      roleNameById(emp.roleId).toLowerCase().includes(lowerQuery) ||
      emp.department.toLowerCase().includes(lowerQuery);
  });

  const handleEditClick = () => {
    setEditForm(selectedEmployee!);
    setIsEditing(true);
  };

  const handleCancelEdit = () => setIsEditing(false);

  const handleSaveEdit = async () => {
    if (!selectedEmployee || !editForm.fullName || !editForm.cpf || !editForm.roleId || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.updateEmployee(selectedEmployee.id, {
        fullName: editForm.fullName, cpf: editForm.cpf, roleId: editForm.roleId,
        email: editForm.email, phone: editForm.phone, address: editForm.address,
        department: editForm.department, contractType: editForm.contractType,
        admissionDate: editForm.admissionDate, baseValue: editForm.baseValue,
        paymentDay: editForm.paymentDay, bankDetails: editForm.bankDetails,
        salaryRecurrenceEnabled: editForm.salaryRecurrenceEnabled,
      });

      // Ligar/desligar a recorrência automática de salário nesta edição.
      if (editForm.salaryRecurrenceEnabled !== selectedEmployee.salaryRecurrenceEnabled) {
        const recurrences = await api.listEmployeeRecurringPayments(selectedEmployee.id);
        const salaryRecurrence = recurrences.filter(r => r.description === 'Salário').pop();
        if (editForm.salaryRecurrenceEnabled && !salaryRecurrence) {
          await api.createEmployeeRecurringPayment(selectedEmployee.id, {
            description: 'Salário', amount: updated.baseValue,
            dueDay: updated.paymentDay === 'last' ? 31 : Number(updated.paymentDay),
          });
        } else if (!editForm.salaryRecurrenceEnabled && salaryRecurrence?.status === 'active') {
          await api.deactivateEmployeeRecurringPayment(salaryRecurrence.id);
        }
      }

      const warnings = await api.listWarnings(selectedEmployee.id);
      setSelectedEmployee({ ...updated, warnings });
      setEmployeeItems(prev => prev.map(e => e.id === updated.id
        ? { id: updated.id, fullName: updated.fullName, roleId: updated.roleId, department: updated.department, contractType: updated.contractType, status: updated.status, cpfMasked: e.cpfMasked, baseValue: updated.baseValue }
        : e));
      setIsEditing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivateEmployee = async () => {
    if (!selectedEmployee || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.deactivateEmployee(selectedEmployee.id);
      setSelectedEmployee(prev => prev ? { ...prev, ...updated } : prev);
      setEmployeeItems(prev => prev.map(e => e.id === updated.id ? { ...e, status: updated.status } : e));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível inativar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReactivateEmployee = async () => {
    if (!selectedEmployee || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const updated = await api.reactivateEmployee(selectedEmployee.id);
      setSelectedEmployee(prev => prev ? { ...prev, ...updated } : prev);
      setEmployeeItems(prev => prev.map(e => e.id === updated.id ? { ...e, status: updated.status } : e));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível reativar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };

  const openWarning = () => {
    setWarningDate(new Date().toISOString().split('T')[0]);
    setWarningReason('');
    setWarningModalOpen(true);
  };

  const handleAddWarning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !warningDate || !warningReason || isSaving) return;
    setIsSaving(true);
    setActionError(null);
    try {
      const created = await api.createWarning(selectedEmployee.id, { occurredAt: warningDate, reason: warningReason });
      setSelectedEmployee({ ...selectedEmployee, warnings: [...selectedEmployee.warnings, created] });
      setWarningModalOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível registrar a advertência.');
    } finally {
      setIsSaving(false);
    }
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

        {/* Load error */}
        {loadError && (
          <div className="glass-panel rounded-3xl border border-red-500/30 bg-red-500/5 p-6 mb-6 text-red-600 dark:text-red-400 text-sm">
            {loadError}
          </div>
        )}

        {/* Data Grid */}
        <div className="glass-panel rounded-3xl border border-border/60 overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="py-24 flex items-center justify-center text-muted">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : filteredEmployees.length > 0 ? (
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
                        onClick={() => setFinanceEmployeeId(emp.id)}
                        onDoubleClick={() => openEmployeeDetail(emp.id)}
                        className="hover:bg-secondary/40 transition-colors group cursor-pointer"
                      >
                        <td className="px-8 py-6">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-sm shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                              {emp.fullName.charAt(0)}
                            </div>
                            <span className="text-base font-heading font-medium text-foreground group-hover:text-primary transition-colors">
                              {emp.fullName}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6 text-muted font-medium">{roleNameById(emp.roleId)}</td>
                        <td className="px-8 py-6 text-muted font-medium">{emp.department}</td>
                        <td className="px-8 py-6">
                          <span className="text-sm font-bold text-foreground">{formatCurrency(emp.baseValue)}</span>
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
                              openEmployeeDetail(emp.id);
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
      {(selectedEmployee || isDrawerLoading || actionError) && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeDrawer}
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
                {isDrawerLoading || !selectedEmployee ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                    {isDrawerLoading ? (
                      <Loader2 className="animate-spin text-muted" size={28} />
                    ) : (
                      <>
                        {actionError && (
                          <div className="w-full rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-600 dark:text-red-400 text-sm">
                            {actionError}
                          </div>
                        )}
                        <button
                          onClick={closeDrawer}
                          className="px-5 py-2.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                        >
                          Fechar
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                <>
                {/* Drawer Header */}
                <div className="p-6 md:p-8 border-b border-border/40 flex flex-col gap-2 relative overflow-hidden shrink-0">
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary opacity-80" />
                  <div className="flex items-start justify-between mt-2">
                    <div className="flex items-center gap-4 flex-1 mr-4">
                      <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-2xl shadow-sm shrink-0">
                        {isEditing && editForm.fullName ? editForm.fullName.charAt(0) : selectedEmployee.fullName.charAt(0)}
                      </div>
                      <div className="flex-1 w-full min-w-0">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editForm.fullName || ''}
                            onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                            className="w-full bg-background border border-border/80 rounded-lg px-3 py-1.5 text-2xl font-heading font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all shadow-sm"
                            placeholder="Nome Completo"
                          />
                        ) : (
                          <h2 className="text-2xl font-heading font-bold text-foreground truncate">
                            {selectedEmployee.fullName}
                          </h2>
                        )}

                        {!isEditing && (
                          <span className="text-muted text-sm font-medium flex items-center gap-1.5 mt-1 truncate">
                            <Briefcase size={14} className="text-primary/70 shrink-0" /> {roleNameById(selectedEmployee.roleId)}
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
                        onClick={closeDrawer}
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

                    {actionError && (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-600 dark:text-red-400 text-sm">
                        {actionError}
                      </div>
                    )}

                    {/* Status Section */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-secondary/20 rounded-2xl border border-border/40 gap-4">
                      <div>
                        <p className="text-xs text-muted uppercase font-bold tracking-wider mb-1">Status Atual</p>
                        <p className="text-sm font-medium text-foreground">Condição do vínculo</p>
                      </div>

                      {!isEditing && (
                        <div className="flex items-center">
                          {selectedEmployee.status === 'active' ? (
                            <span className="px-4 py-2 rounded-full text-xs font-bold bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 whitespace-nowrap">
                              ATIVO
                            </span>
                          ) : (
                            <span className="px-4 py-2 rounded-full text-xs font-bold bg-secondary text-foreground/60 border border-border/60 whitespace-nowrap">
                              INATIVO
                            </span>
                          )}
                          {selectedEmployee.status === 'active' ? (
                            <button onClick={handleDeactivateEmployee} disabled={isSaving} className="ml-3 text-xs font-bold text-red-500 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 disabled:opacity-60">
                              <Ban size={12} /> Inativar
                            </button>
                          ) : (
                            <button onClick={handleReactivateEmployee} disabled={isSaving} className="ml-3 text-xs font-bold text-primary hover:bg-primary/10 px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 disabled:opacity-60">
                              <RotateCcw size={12} /> Reativar
                            </button>
                          )}
                        </div>
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
                                {formatDateOnly(selectedEmployee.admissionDate)}
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
                              <p className="text-sm font-medium text-foreground">{formatCurrency(selectedEmployee.baseValue)}</p>
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
                                  {selectedEmployee.salaryRecurrenceEnabled ? 'Ativada (Mensal)' : 'Desativada'}
                                </p>
                              </div>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${selectedEmployee.salaryRecurrenceEnabled ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted'}`}>
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
                                    <p className="text-xs text-muted mt-1">{new Date(warning.occurredAt).toLocaleDateString('pt-BR')}</p>
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
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Cargo</label>
                                <CustomSelect
                                  value={editForm.roleId || ''}
                                  onChange={(val) => {
                                    const role = roles.find(r => r.id === val);
                                    setEditForm({ ...editForm, roleId: val, department: role?.department ?? editForm.department });
                                  }}
                                  options={roles.map(r => ({ value: r.id, label: `${r.name} (${r.department})` }))}
                                  className="!py-2.5 !px-3"
                                />
                              </div>
                              <div>
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
                                  onChange={(val) => setEditForm({ ...editForm, contractType: val as Employee['contractType'] })}
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
                                <input type="number" value={editForm.baseValue ?? ''} onChange={(e) => setEditForm({ ...editForm, baseValue: Number(e.target.value) })} className="w-full bg-background border border-border/80 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="0,00" />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground/80 mb-1.5">Dia de Pagamento</label>
                                <CustomSelect
                                  value={editForm.paymentDay || ''}
                                  onChange={(val) => setEditForm({ ...editForm, paymentDay: val as Employee['paymentDay'] })}
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
                                  value={editForm.salaryRecurrenceEnabled ? 'yes' : 'no'}
                                  onChange={(val) => setEditForm({ ...editForm, salaryRecurrenceEnabled: val === 'yes' })}
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
                        disabled={isSaving}
                        className="flex-1 py-3.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <Save size={18} />
                        {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                </>
                )}

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

                {actionError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
                    {actionError}
                  </div>
                )}

                <form onSubmit={handleAddWarning} className="space-y-6">
                  <div className="bg-secondary/20 border border-border/40 p-4 rounded-2xl flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
                      {selectedEmployee.fullName.charAt(0)}
                    </div>
                    <div>
                      <p className="text-base font-bold text-foreground">{selectedEmployee.fullName}</p>
                      <p className="text-sm text-muted font-medium">{roleNameById(selectedEmployee.roleId)}</p>
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
                      disabled={!warningDate || !warningReason.trim() || isSaving}
                      className="flex-1 py-4 bg-red-500 hover:bg-red-600 text-white rounded-xl text-base font-bold transition-colors shadow-lg shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSaving ? 'Registrando...' : 'Registrar'}
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
      {financeEmployeeId && createPortal(
        <FinanceAndVacationModal
          employeeId={financeEmployeeId}
          onClose={() => setFinanceEmployeeId(null)}
        />,
        document.body
      )}

    </div>
  );
};

export default EmployeesList;
