import React, { useState, useEffect } from 'react';
import { ArrowLeft, Briefcase, User, Wallet } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';
import PermissionDeniedNotice from '../../components/PermissionDeniedNotice';
import { Button, ButtonLink, Field, Input, Notice, Select, Switch, Tabs, toast } from '../../components/ui';
import * as api from '../../lib/api';
import type { EmployeeListItem, Role } from '../../lib/api';
import { ApiError } from '../../lib/apiError';
import { useCan } from '../../lib/auth';
import {
  formatPhoneInput, formatCpfInput, isValidCpf, isValidEmail, isValidPhone,
  MONEY_MAX_VALUE, NAME_MAX_LENGTH,
} from '../../lib/validation';

// Cadastro de funcionário (redesenho no kit de peças, 01/10/2026). A aba "Advertências" que existia
// aqui foi removida: era só um botão sem ação — advertência se registra na ficha, depois de criado.

type Tab = 'pessoal' | 'vinculo' | 'financeiro';

const TABS = [
  { id: 'pessoal' as const, label: 'Dados pessoais', icon: User },
  { id: 'vinculo' as const, label: 'Cargo e vínculo', icon: Briefcase },
  { id: 'financeiro' as const, label: 'Financeiro', icon: Wallet },
];

const EmployeeForm = () => {
  const navigate = useNavigate();
  const canCreate = useCan()('funcionarios.gerenciar');
  const [activeTab, setActiveTab] = useState<Tab>('pessoal');
  const [roles, setRoles] = useState<Role[]>([]);
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Dados pessoais
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // Validação visual por campo (17/09/2026) — espelha as regras do backend (checksum de CPF, formato
  // de telefone/e-mail, teto de tamanho/valor); mostrada ao sair do campo, nunca a cada tecla.
  const [fullNameError, setFullNameError] = useState<string>();
  const [cpfError, setCpfError] = useState<string>();
  const [emailError, setEmailError] = useState<string>();
  const [phoneError, setPhoneError] = useState<string>();
  const [departmentError, setDepartmentError] = useState<string>();
  const [baseValueError, setBaseValueError] = useState<string>();

  // Cargo e vínculo
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

  // Roda de novo no submit (não só no blur) — cobre quem nunca saiu do campo ou colou um valor via
  // autofill. Devolve a aba do primeiro erro, pra já trocar pra ela.
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
    if (errors.fullName || errors.cpf || errors.email || errors.phone) return { valid: false, tab: 'pessoal' } as const;
    if (errors.department) return { valid: false, tab: 'vinculo' } as const;
    if (errors.baseValue) return { valid: false, tab: 'financeiro' } as const;
    return { valid: true } as const;
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSaving) return;

    const missing: Array<[string, Tab]> = [];
    if (!fullName) missing.push(['Nome completo', 'pessoal']);
    if (!cpf) missing.push(['CPF', 'pessoal']);
    if (!roleId) missing.push(['Cargo', 'vinculo']);
    if (!department) missing.push(['Departamento', 'vinculo']);
    if (!admissionDate) missing.push(['Data de admissão', 'vinculo']);
    if (!baseValue) missing.push(['Salário base', 'financeiro']);
    if (missing.length > 0) {
      setActiveTab(missing[0][1]);
      setSaveError(`Preencha os campos obrigatórios: ${missing.map(([label]) => label).join(', ')}.`);
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
          // Funcionário já foi criado — a recorrência pode ser configurada depois em Pagamentos e férias.
          recurrenceWarning = true;
        }
      }

      toast.success(`Funcionário cadastrado: ${created.fullName}`);
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
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/app/funcionarios" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground transition-colors">
          <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" /> Funcionários
        </Link>
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[26px] md:text-[28px] font-semibold tracking-tight text-foreground leading-tight">Novo funcionário</h1>
            <p className="mt-1 text-[14px] text-muted">Os campos com * são obrigatórios. Advertências e férias ficam na ficha, depois do cadastro.</p>
          </div>
          <div className="flex gap-2">
            <ButtonLink to="/app/funcionarios" variant="secondary">Cancelar</ButtonLink>
            <Button onClick={() => handleSave()} loading={isSaving}>Salvar funcionário</Button>
          </div>
        </header>

        {saveError && <Notice tone="danger" className="mb-4">{saveError}</Notice>}

        <form onSubmit={handleSave} className="bg-panel border border-border rounded-lg shadow-sm">
          <Tabs<Tab> label="Seções do cadastro" tabs={TABS} value={activeTab} onChange={setActiveTab} className="px-3" />

          <div className="p-5 md:p-6">
            {activeTab === 'pessoal' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nome completo" htmlFor="f-name" required error={fullNameError} className="md:col-span-2">
                  <Input
                    id="f-name" value={fullName} maxLength={NAME_MAX_LENGTH} invalid={!!fullNameError}
                    onChange={(e) => setFullName(e.target.value)}
                    onBlur={() => setFullNameError(fullName.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined)}
                    placeholder="Nome completo do funcionário"
                  />
                </Field>
                <Field label="CPF" htmlFor="f-cpf" required error={cpfError}>
                  <Input
                    id="f-cpf" value={cpf} maxLength={14} invalid={!!cpfError} inputMode="numeric"
                    onChange={(e) => setCpf(formatCpfInput(e.target.value))}
                    onBlur={() => setCpfError(cpf && !isValidCpf(cpf) ? 'CPF inválido' : undefined)}
                    placeholder="000.000.000-00"
                  />
                </Field>
                <Field label="E-mail" htmlFor="f-email" error={emailError}>
                  <Input
                    id="f-email" type="email" value={email} invalid={!!emailError}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setEmailError(email && !isValidEmail(email) ? 'E-mail inválido' : undefined)}
                    placeholder="email@exemplo.com"
                  />
                </Field>
                <Field label="Telefone / WhatsApp" htmlFor="f-phone" error={phoneError}>
                  <Input
                    id="f-phone" value={phone} maxLength={15} invalid={!!phoneError} inputMode="tel"
                    onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                    onBlur={() => setPhoneError(phone && !isValidPhone(phone) ? 'Telefone deve ter DDD + 8 ou 9 dígitos' : undefined)}
                    placeholder="(00) 00000-0000"
                  />
                </Field>
                <Field label="Endereço" htmlFor="f-address">
                  <Input id="f-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, bairro, cidade" />
                </Field>
              </div>
            )}

            {activeTab === 'vinculo' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {loadError && <Notice tone="danger" className="md:col-span-2">{loadError}</Notice>}
                <Field label="Cargo" htmlFor="f-role" required hint="Os cargos são cadastrados na tela de Cargos." className="md:col-span-2">
                  <Select
                    id="f-role" value={roleId}
                    onChange={(e) => {
                      setRoleId(e.target.value);
                      const role = roles.find((r) => r.id === e.target.value);
                      if (role) setDepartment(role.department);
                    }}
                  >
                    <option value="" disabled>Selecione um cargo</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.department})</option>)}
                  </Select>
                </Field>
                <Field label="Superior" htmlFor="f-manager" className="md:col-span-2" hint="Quem administra o ponto deste funcionário (aprova ou rejeita ajustes e corrige marcações). Opcional.">
                  <Select id="f-manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                    <option value="">Nenhum (sem superior)</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                  </Select>
                </Field>
                <Field label="Departamento" htmlFor="f-dept" required error={departmentError} className="md:col-span-2">
                  <Input
                    id="f-dept" value={department} maxLength={NAME_MAX_LENGTH} invalid={!!departmentError}
                    onChange={(e) => setDepartment(e.target.value)}
                    onBlur={() => setDepartmentError(department.length > NAME_MAX_LENGTH ? `Departamento deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined)}
                  />
                </Field>
                <Field label="Data de admissão" htmlFor="f-admission" required>
                  <Input id="f-admission" type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
                </Field>
                <Field label="Tipo de contrato" htmlFor="f-contract">
                  <Select id="f-contract" value={contractType} onChange={(e) => setContractType(e.target.value as typeof contractType)}>
                    <option value="clt">CLT</option>
                    <option value="pj">PJ</option>
                    <option value="estagio">Estágio</option>
                  </Select>
                </Field>
              </div>
            )}

            {activeTab === 'financeiro' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Salário base (R$)" htmlFor="f-salary" required error={baseValueError}>
                  <Input
                    id="f-salary" type="number" min={0} step="0.01" value={baseValue} invalid={!!baseValueError}
                    onChange={(e) => setBaseValue(e.target.value)}
                    onBlur={() => setBaseValueError(baseValue && Number(baseValue) > MONEY_MAX_VALUE ? `Salário deve ser menor ou igual a ${MONEY_MAX_VALUE.toLocaleString('pt-BR')}` : undefined)}
                    placeholder="0,00"
                  />
                </Field>
                <Field label="Dia de pagamento" htmlFor="f-payday">
                  <Select id="f-payday" value={paymentDay} onChange={(e) => setPaymentDay(e.target.value as typeof paymentDay)}>
                    <option value="5">5º dia útil</option>
                    <option value="15">Dia 15</option>
                    <option value="20">Dia 20</option>
                    <option value="last">Último dia útil</option>
                  </Select>
                </Field>
                <Field label="Dados bancários" htmlFor="f-bank" hint="Opcional: banco, agência, conta ou PIX." className="md:col-span-2">
                  <Input id="f-bank" value={bankDetails} onChange={(e) => setBankDetails(e.target.value)} />
                </Field>
                <div className="md:col-span-2 rounded-md border border-border px-4 py-3">
                  <Switch
                    checked={salaryRecurrenceEnabled}
                    onChange={setSalaryRecurrenceEnabled}
                    label="Gerar o salário automaticamente todo mês"
                    description="Cria o pagamento do salário no dia escolhido, sem precisar lançar à mão."
                  />
                </div>
              </div>
            )}

            <CustomFieldsFormSection entity="employee" values={customFields} onChange={setCustomFields} />
          </div>
          {/* Enter dentro de um campo envia o formulário. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      </div>
    </div>
  );
};

export default EmployeeForm;
