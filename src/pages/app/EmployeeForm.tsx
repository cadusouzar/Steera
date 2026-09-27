import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, User, Briefcase, DollarSign, AlertTriangle, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CustomSelect from '../../components/CustomSelect';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';
import FormField from '../../components/FormField';
import PermissionDeniedNotice from '../../components/PermissionDeniedNotice';
import * as api from '../../lib/api';
import type { EmployeeListItem, Role } from '../../lib/api';
import { ApiError } from '../../lib/apiError';
import { useCan } from '../../lib/auth';
import {
  formatPhoneInput, formatCpfInput, inputBorderClass, isValidCpf, isValidEmail, isValidPhone,
  MONEY_MAX_VALUE, NAME_MAX_LENGTH,
} from '../../lib/validation';

const EmployeeForm = () => {
  const navigate = useNavigate();
  const canCreate = useCan()('funcionarios.gerenciar');
  const [activeTab, setActiveTab] = useState('pessoal');
  const [roles, setRoles] = useState<Role[]>([]);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Dados Pessoais
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // Validação visual por campo (17/09/2026) — espelha as mesmas regras que o backend já aplica
  // (checksum de CPF, formato de telefone/e-mail, teto de tamanho/valor); mostrado ao sair do
  // campo (`onBlur`), nunca a cada tecla, pra não incomodar no meio da digitação.
  const [fullNameError, setFullNameError] = useState<string>();
  const [cpfError, setCpfError] = useState<string>();
  const [emailError, setEmailError] = useState<string>();
  const [phoneError, setPhoneError] = useState<string>();
  const [departmentError, setDepartmentError] = useState<string>();
  const [baseValueError, setBaseValueError] = useState<string>();

  // Cargo & Vínculo
  const [roleId, setRoleId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [department, setDepartment] = useState('');
  const [admissionDate, setAdmissionDate] = useState('');
  const [contractType, setContractType] = useState<'clt' | 'pj' | 'estagio'>('clt');

  // Financeiro
  const [baseValue, setBaseValue] = useState('');
  const [paymentDay, setPaymentDay] = useState<'5' | '15' | '20' | 'last'>('5');
  const [bankDetails, setBankDetails] = useState('');
  const [salaryRecurrenceEnabled, setSalaryRecurrenceEnabled] = useState(true);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!canCreate) return;
    api.listActiveRoles().then(setRoles).catch((err) => {
      setRoles([]);
      // 403 PERMISSION_REQUIRED (perfil sem `cargos.ver`): mostra a mensagem do backend, que já
      // explica o motivo; qualquer outra falha segue com o texto genérico.
      setLoadError(
        err instanceof ApiError && err.status === 403
          ? err.message
          : 'Não foi possível carregar a lista de cargos. Recarregue a página para tentar novamente.',
      );
    });
    // Lista completa (não só ativos) — um funcionário pode reportar a alguém que depois foi
    // inativado; a empresa decide se isso é um problema, não escondemos a opção aqui.
    api.listEmployees().then(setEmployees).catch(() => setEmployees([]));
  }, [canCreate]);

  const tabs = [
    { id: 'pessoal', label: 'Dados Pessoais', icon: <User size={16} /> },
    { id: 'vinculo', label: 'Cargo & Vínculo', icon: <Briefcase size={16} /> },
    { id: 'financeiro', label: 'Financeiro', icon: <DollarSign size={16} /> },
    { id: 'advertencias', label: 'Advertências', icon: <AlertTriangle size={16} /> },
  ];

  // Roda de novo no submit (não só no blur) — cobre o caso de a pessoa nunca ter saído do campo,
  // ou ter colado um valor via script/autofill sem disparar `onBlur`. Devolve o primeiro erro de
  // cada campo (ou undefined) e a aba onde ele mora, pra já trocar pra ela se precisar.
  const validateAll = () => {
    const errors = {
      fullName: fullName && fullName.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined,
      cpf: cpf && !isValidCpf(cpf) ? 'CPF inválido' : undefined,
      email: email && !isValidEmail(email) ? 'E-mail inválido' : undefined,
      phone: phone && !isValidPhone(phone) ? 'Telefone deve ter DDD + 8 ou 9 dígitos' : undefined,
      department: department && department.length > NAME_MAX_LENGTH ? `Departamento deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined,
      baseValue: baseValue && Number(baseValue) > MONEY_MAX_VALUE ? `Salário deve ser menor ou igual a ${MONEY_MAX_VALUE.toLocaleString('pt-BR')}` : undefined,
    };
    setFullNameError(errors.fullName);
    setCpfError(errors.cpf);
    setEmailError(errors.email);
    setPhoneError(errors.phone);
    setDepartmentError(errors.department);
    setBaseValueError(errors.baseValue);
    if (errors.fullName || errors.cpf) return { valid: false, tab: 'pessoal' } as const;
    if (errors.email || errors.phone) return { valid: false, tab: 'pessoal' } as const;
    if (errors.department) return { valid: false, tab: 'vinculo' } as const;
    if (errors.baseValue) return { valid: false, tab: 'financeiro' } as const;
    return { valid: true } as const;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const missingFields: string[] = [];
    if (!fullName) missingFields.push('Nome Completo');
    if (!cpf) missingFields.push('CPF');
    if (!roleId) missingFields.push('Cargo');
    if (!admissionDate) missingFields.push('Data de Admissão');
    if (!department) missingFields.push('Departamento');
    if (!baseValue) missingFields.push('Salário Base');
    if (missingFields.length > 0) {
      setSaveError(`Preencha os campos obrigatórios: ${missingFields.join(', ')}.`);
      return;
    }

    const validation = validateAll();
    if (!validation.valid) {
      setActiveTab(validation.tab);
      setSaveError('Corrija os campos destacados antes de salvar.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const created = await api.createEmployee({
        fullName, cpf, roleId, managerId: managerId || undefined, email: email || undefined, phone: phone || undefined,
        address: address || undefined, contractType, admissionDate, department,
        baseValue: Number(baseValue), paymentDay, bankDetails: bankDetails || undefined,
        salaryRecurrenceEnabled, customFields,
      });

      let recurrenceWarning = false;
      if (salaryRecurrenceEnabled) {
        try {
          await api.createEmployeeRecurringPayment(created.id, {
            description: 'Salário', amount: created.baseValue,
            dueDay: paymentDay === 'last' ? 31 : Number(paymentDay),
          });
        } catch {
          // Funcionário já foi criado — a recorrência pode ser configurada depois na aba de pagamentos.
          recurrenceWarning = true;
        }
      }

      navigate('/app/funcionarios', recurrenceWarning ? { state: { recurrenceWarning: true } } : undefined);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Não foi possível salvar o funcionário.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!canCreate) {
    return <PermissionDeniedNotice message="Seu perfil não permite cadastrar funcionários." backTo="/app/funcionarios" backLabel="Voltar para Funcionários" />;
  }

  return (
    <div className="p-6 md:p-8">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link
              to="/app/funcionarios"
              className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">Novo Funcionário</h1>
              <p className="text-muted text-sm mt-1">Preencha o dossiê do colaborador.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/app/funcionarios')}
              className="px-5 py-2.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary/50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
              {isSaving ? 'Salvando...' : 'Salvar Registro'}
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {saveError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
            {saveError}
          </div>
        )}

        {/* Content Area with Tabs */}
        <div className="glass-panel rounded-[2rem] border border-border/50">
          {/* Tab Navigation */}
          <div className="flex border-b border-border/50 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                  activeTab === tab.id 
                    ? 'border-primary text-primary bg-primary/5' 
                    : 'border-transparent text-muted hover:text-foreground hover:bg-secondary/20'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Form Content */}
          <form className="p-6 md:p-8" onSubmit={handleSave}>
            {activeTab === 'pessoal' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <FormField label="Nome Completo" required error={fullNameError}>
                      <input
                        type="text" value={fullName} maxLength={NAME_MAX_LENGTH}
                        onChange={(e) => setFullName(e.target.value)}
                        onBlur={() => setFullNameError(fullName.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined)}
                        className={`w-full bg-background border ${inputBorderClass(!!fullNameError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                        placeholder="Nome completo do funcionário"
                      />
                    </FormField>
                  </div>
                  <FormField label="CPF" required error={cpfError}>
                    <input
                      type="text" value={cpf} maxLength={14}
                      onChange={(e) => setCpf(formatCpfInput(e.target.value))}
                      onBlur={() => setCpfError(cpf && !isValidCpf(cpf) ? 'CPF inválido' : undefined)}
                      className={`w-full bg-background border ${inputBorderClass(!!cpfError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                      placeholder="000.000.000-00"
                    />
                  </FormField>
                  <FormField label="E-mail Pessoal" error={emailError}>
                    <input
                      type="email" value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onBlur={() => setEmailError(email && !isValidEmail(email) ? 'E-mail inválido' : undefined)}
                      className={`w-full bg-background border ${inputBorderClass(!!emailError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                      placeholder="email@exemplo.com"
                    />
                  </FormField>
                  <FormField label="Telefone / WhatsApp" error={phoneError}>
                    <input
                      type="text" value={phone} maxLength={15}
                      onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                      onBlur={() => setPhoneError(phone && !isValidPhone(phone) ? 'Telefone deve ter DDD + 8 ou 9 dígitos' : undefined)}
                      className={`w-full bg-background border ${inputBorderClass(!!phoneError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                      placeholder="(00) 00000-0000"
                    />
                  </FormField>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Endereço Completo</label>
                    <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50" placeholder="Rua, Número, Bairro, Cidade - Estado" />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'vinculo' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Cargo</label>
                    {loadError && (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 mb-3 text-red-600 dark:text-red-400 text-xs">
                        {loadError}
                      </div>
                    )}
                    <CustomSelect
                      value={roleId}
                      onChange={(val) => {
                        setRoleId(val);
                        const role = roles.find(r => r.id === val);
                        if (role) setDepartment(role.department);
                      }}
                      options={roles.map(r => ({ value: r.id, label: `${r.name} (${r.department})` }))}
                      placeholder="Selecione um cargo..."
                    />
                    <p className="text-xs text-muted mt-2">Os cargos devem ser cadastrados previamente na tela de Cargos.</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Superior (opcional)</label>
                    <CustomSelect
                      value={managerId}
                      onChange={setManagerId}
                      options={[
                        { value: '', label: 'Nenhum — sem superior' },
                        ...employees.map(e => ({ value: e.id, label: e.fullName })),
                      ]}
                      placeholder="Selecione um superior..."
                    />
                    <p className="text-xs text-muted mt-2">
                      Define quem administra o ponto deste funcionário (aprova/rejeita solicitações de
                      ajuste, corrige marcações) — moldável por empresa, sem hierarquia fixa.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <FormField label="Departamento" required error={departmentError}>
                      <input
                        type="text" value={department} maxLength={NAME_MAX_LENGTH}
                        onChange={(e) => setDepartment(e.target.value)}
                        onBlur={() => setDepartmentError(department.length > NAME_MAX_LENGTH ? `Departamento deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined)}
                        className={`w-full bg-background border ${inputBorderClass(!!departmentError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                      />
                    </FormField>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Data de Admissão</label>
                    <input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 text-foreground" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Tipo de Contrato</label>
                    <CustomSelect
                      value={contractType}
                      onChange={(val) => setContractType(val as typeof contractType)}
                      options={[
                        { value: 'clt', label: 'CLT' },
                        { value: 'pj', label: 'PJ' },
                        { value: 'estagio', label: 'Estágio' }
                      ]}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'financeiro' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField label="Salário Base (R$)" required error={baseValueError}>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted">R$</span>
                      <input
                        type="number" step="0.01" value={baseValue}
                        onChange={(e) => setBaseValue(e.target.value)}
                        onBlur={() => setBaseValueError(baseValue && Number(baseValue) > MONEY_MAX_VALUE ? `Salário deve ser menor ou igual a ${MONEY_MAX_VALUE.toLocaleString('pt-BR')}` : undefined)}
                        className={`w-full bg-background border ${inputBorderClass(!!baseValueError)} rounded-xl pl-10 pr-4 py-3 focus:ring-2 transition-colors`}
                        placeholder="0,00"
                      />
                    </div>
                  </FormField>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Dia de Pagamento</label>
                    <CustomSelect
                      value={paymentDay}
                      onChange={(val) => setPaymentDay(val as typeof paymentDay)}
                      options={[
                        { value: '5', label: 'Dia 5 útil' },
                        { value: '15', label: 'Dia 15' },
                        { value: '20', label: 'Dia 20' },
                        { value: 'last', label: 'Último dia útil' }
                      ]}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Dados Bancários (Opcional)</label>
                    <input type="text" value={bankDetails} onChange={(e) => setBankDetails(e.target.value)} className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50" placeholder="Banco, Agência, Conta PIX..." />
                  </div>
                  <div className="md:col-span-2 flex items-center justify-between p-5 bg-primary/5 rounded-xl border border-primary/20 mt-2">
                    <div>
                      <h4 className="font-semibold text-primary mb-1">Recorrência de Salário</h4>
                      <p className="text-sm text-muted">Gerar despesa de salário automaticamente todo mês, para não precisar adicionar manualmente.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" className="sr-only peer" checked={salaryRecurrenceEnabled} onChange={(e) => setSalaryRecurrenceEnabled(e.target.checked)} />
                      <div className="w-14 h-7 bg-secondary border-border border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary shadow-inner"></div>
                    </label>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'advertencias' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="text-center py-10 bg-secondary/20 rounded-2xl border border-dashed border-border">
                  <AlertTriangle size={32} className="mx-auto text-muted mb-3" />
                  <h3 className="font-medium text-foreground mb-1">Nenhuma advertência</h3>
                  <p className="text-sm text-muted mb-4">Este funcionário tem o histórico limpo.</p>
                  <button type="button" className="text-sm font-medium text-primary hover:underline">
                    + Registrar nova advertência
                  </button>
                </div>
              </motion.div>
            )}

            <CustomFieldsFormSection entity="employee" values={customFields} onChange={setCustomFields} />
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export default EmployeeForm;
