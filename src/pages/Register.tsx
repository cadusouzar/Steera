import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import Mascot from '../components/Mascot';
import FlowBackground from '../components/FlowBackground';
import FormField from '../components/FormField';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import { usePasswordStrength } from '../hooks/usePasswordStrength';
import { buildPasswordUserInputs, isWeakPasswordError } from '../lib/passwordStrength';
import { register, type RegisterPayload } from '../lib/auth';
import { fetchAddressByCep, fetchCnpjData } from '../lib/brazilLookups';
import {
  BRAZILIAN_STATES,
  formatCepInput,
  formatCnpjInput,
  formatCpfInput,
  formatPhoneInput,
  inputBorderClass,
  isValidCnpj,
  isValidCpf,
  isValidEmail,
  isValidPhone,
  NAME_MAX_LENGTH,
  stripCnpj,
} from '../lib/validation';

type Step = 0 | 1 | 2;
type PersonType = 'PJ' | 'PF';

interface FormState {
  personType: PersonType;
  document: string;
  legalName: string;
  tradeName: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  name: string;
  email: string;
  password: string;
  // Só no formulário — nunca vai no payload do cadastro.
  confirmPassword: string;
}

const EMPTY_FORM: FormState = {
  personType: 'PJ', document: '', legalName: '', tradeName: '', phone: '',
  zipCode: '', street: '', number: '', complement: '', district: '', city: '', state: '',
  name: '', email: '', password: '', confirmPassword: '',
};

const STEP_TITLES = ['Empresa', 'Endereço', 'Seu acesso'] as const;

type Errors = Partial<Record<keyof FormState, string>>;

function required(value: string, label: string): string | undefined {
  if (!value.trim()) return `${label} é obrigatório`;
  if (value.length > NAME_MAX_LENGTH) return `${label} deve ter no máximo ${NAME_MAX_LENGTH} caracteres`;
  return undefined;
}

// `password`: estado do medidor de força (usePasswordStrength) — só usado na etapa 3.
function validateStep(step: Step, f: FormState, password = { isStrong: false, isChecking: false }): Errors {
  const e: Errors = {};
  if (step === 0) {
    const isPJ = f.personType === 'PJ';
    e.document = !f.document.trim()
      ? `${isPJ ? 'CNPJ' : 'CPF'} é obrigatório`
      : (isPJ ? isValidCnpj(f.document) : isValidCpf(f.document)) ? undefined : `${isPJ ? 'CNPJ' : 'CPF'} inválido`;
    e.legalName = required(f.legalName, isPJ ? 'Razão social' : 'Nome completo');
    e.tradeName = isPJ ? required(f.tradeName, 'Nome fantasia') : f.tradeName.length > NAME_MAX_LENGTH ? `Nome fantasia deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined;
    e.phone = !f.phone.trim() ? 'Telefone é obrigatório' : isValidPhone(f.phone) ? undefined : 'Telefone inválido';
  } else if (step === 1) {
    e.zipCode = f.zipCode.replace(/\D/g, '').length === 8 ? undefined : 'CEP deve ter 8 dígitos';
    e.street = required(f.street, 'Logradouro');
    e.number = !f.number.trim()
      ? 'Número é obrigatório'
      : f.number.length > 20 ? 'Número deve ter no máximo 20 caracteres' : undefined;
    e.district = required(f.district, 'Bairro');
    e.city = required(f.city, 'Cidade');
    e.state = (BRAZILIAN_STATES as readonly string[]).includes(f.state) ? undefined : 'Selecione a UF';
  } else {
    e.name = required(f.name, 'Seu nome');
    e.email = !f.email.trim() ? 'E-mail é obrigatório' : isValidEmail(f.email) ? undefined : 'E-mail inválido';
    e.password = f.password.length < 8
      ? 'Senha deve ter pelo menos 8 caracteres'
      : password.isStrong ? undefined
      : password.isChecking ? 'Aguarde a verificação da força da senha.' : 'Escolha uma senha mais forte para continuar.';
    e.confirmPassword = f.confirmPassword === f.password ? undefined : 'As senhas não coincidem';
  }
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Errors;
}

const Register = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [planName, setPlanName] = useState<string>('');

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isCovering, setIsCovering] = useState(false);

  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Errors>({});
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  // Dados já digitados viram "palavras proibidas" da senha (ex.: "padariacentral2026" é fraca).
  const passwordUserInputs = useMemo(
    () => buildPasswordUserInputs([form.email, form.name, form.legalName, form.tradeName]),
    [form.email, form.name, form.legalName, form.tradeName],
  );
  const passwordStrength = usePasswordStrength(form.password, passwordUserInputs);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Espelha `form` num ref pra poder ler o valor MAIS RECENTE dentro de um `await` já em voo — os
  // handlers de lookup abaixo são recriados a cada render com o `form` daquele render preso no
  // closure, então sem isso não teríamos como saber, depois do `await`, se o usuário já mudou o
  // campo enquanto a resposta ainda não tinha chegado.
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  // Contadores de sequência por campo — cada chamada de lookup incrementa o seu antes do fetch;
  // se, quando a resposta chegar, o contador já tiver avançado de novo (outro blur disparou uma
  // busca mais nova), a resposta é obsoleta e é descartada (a busca mais nova é quem manda no
  // spinner/nos dados a partir daí). Evita que, ao editar o CNPJ/CEP e sair do campo de novo antes
  // da primeira resposta voltar (até 5s/3s), a resposta mais LENTA vença e preencha os campos com
  // dado de outra empresa/endereço.
  const cnpjLookupSeq = useRef(0);
  const cepLookupSeq = useRef(0);

  // Campos cujo valor atual veio de um autopreenchimento (BrasilAPI/ViaCEP), não da digitação do
  // usuário. Uma busca mais nova bem-sucedida pode sobrescrever ESTES (ex.: corrigiu o CNPJ A → B,
  // os dados de A não podem ficar ao lado do CNPJ de B); o que o usuário digitou nunca é tocado.
  // Digitar num campo tira ele daqui.
  const autofilledKeys = useRef<Set<keyof FormState>>(new Set());

  useEffect(() => {
    const plan = searchParams.get('plan');
    if (plan) {
      setPlanName(plan.charAt(0).toUpperCase() + plan.slice(1));
    }
  }, [searchParams]);

  // Erro de um campo some assim que o campo é escrito de novo (digitação ou autopreenchimento) —
  // antes ficava "CNPJ inválido" embaixo de um CNPJ já corrigido até o próximo "Próximo".
  const clearFieldErrors = (keys: (keyof FormState)[]) => {
    if (keys.length === 0) return;
    setErrors((prev) => {
      if (!keys.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    autofilledKeys.current.delete(key);
    setForm((f) => ({ ...f, [key]: value }));
    clearFieldErrors([key]);
  };

  // Troca de etapa (nos dois sentidos) limpa avisos de busca e o banner de erro da etapa anterior:
  // um aviso de outra etapa sumindo depois (no blur do CEP, por exemplo) empurrava os botões entre
  // o mousedown e o click, e o primeiro "Próximo" se perdia.
  const changeStep = (next: Step) => {
    setLookupNotice(null);
    setError(null);
    setStep(next);
  };

  const goNext = () => {
    const stepErrors = validateStep(step, form);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) changeStep((step + 1) as Step);
  };

  // Preenche campos vazios ou que vieram de um autopreenchimento anterior — nunca sobrescreve o que
  // o usuário digitou. Um campo antes autopreenchido que a busca nova não traz é esvaziado (dado da
  // busca anterior não corresponde mais ao documento/CEP atual).
  const fillFromLookup = (patch: Partial<FormState>) => {
    const current = formRef.current;
    const keys = (Object.keys(patch) as (keyof FormState)[]).filter((k) => {
      const value = patch[k] ?? '';
      if (autofilledKeys.current.has(k)) return true;
      return value !== '' && !current[k].trim();
    });
    if (keys.length === 0) return;
    for (const k of keys) {
      if (patch[k]) autofilledKeys.current.add(k);
      else autofilledKeys.current.delete(k);
    }
    setForm((f) => {
      const next = { ...f };
      for (const k of keys) next[k] = (patch[k] ?? '') as never;
      return next;
    });
    clearFieldErrors(keys.filter((k) => patch[k]));
  };

  const handleDocumentBlur = async () => {
    if (form.personType !== 'PJ' || !isValidCnpj(form.document)) return;
    const requestedDocument = form.document;
    const seq = ++cnpjLookupSeq.current;
    setIsLookingUp(true);
    setLookupNotice(null);
    const data = await fetchCnpjData(requestedDocument);
    // Resposta obsoleta: uma busca mais nova já foi disparada (outro blur) — ela é quem controla
    // o spinner/os dados a partir daqui, não aplicamos nada desta.
    if (seq !== cnpjLookupSeq.current) return;
    setIsLookingUp(false);
    // Nenhuma busca mais nova em voo, mas o usuário já editou o CNPJ de novo antes desta resposta
    // chegar (sem ainda ter saído do campo) — o valor buscado não corresponde mais ao que está
    // digitado, então descartamos pra não preencher com dado de outro CNPJ.
    if (stripCnpj(formRef.current.document) !== stripCnpj(requestedDocument)) return;
    if (!data) {
      setLookupNotice('Não conseguimos buscar os dados deste CNPJ, preencha manualmente.');
      return;
    }
    fillFromLookup({
      legalName: data.legalName,
      tradeName: data.tradeName,
      phone: data.phone ? formatPhoneInput(data.phone) : '',
      zipCode: data.address.zipCode ? formatCepInput(data.address.zipCode) : '',
      street: data.address.street,
      number: data.address.number,
      complement: data.address.complement,
      district: data.address.district,
      city: data.address.city,
      state: data.address.state,
    });
    if (data.registrationStatus && data.registrationStatus !== 'ATIVA') {
      setLookupNotice(`Atenção: este CNPJ consta como ${data.registrationStatus} na Receita Federal.`);
    }
  };

  const handleCepBlur = async () => {
    if (form.zipCode.replace(/\D/g, '').length !== 8) return;
    const requestedZip = form.zipCode;
    const seq = ++cepLookupSeq.current;
    setIsLookingUp(true);
    setLookupNotice(null);
    const address = await fetchAddressByCep(requestedZip);
    // Mesma proteção contra resposta obsoleta do CNPJ acima, aplicada ao CEP: descarta se uma
    // busca mais nova já está em voo, ou se o CEP digitado já mudou antes desta resposta chegar.
    if (seq !== cepLookupSeq.current) return;
    setIsLookingUp(false);
    if (formRef.current.zipCode.replace(/\D/g, '') !== requestedZip.replace(/\D/g, '')) return;
    if (!address) {
      setLookupNotice('Não encontramos este CEP, preencha o endereço manualmente.');
      return;
    }
    fillFromLookup({ street: address.street, district: address.district, city: address.city, state: address.state });
  };

  const handlePersonTypeChange = (t: PersonType) => {
    setForm((f) => ({ ...f, personType: t, document: '' }));
    setErrors({});
    setLookupNotice(null);
    setError(null);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step < 2) return goNext();
    const stepErrors = validateStep(2, form, passwordStrength);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const payload: RegisterPayload = {
        personType: form.personType,
        document: form.document,
        legalName: form.legalName.trim(),
        tradeName: form.tradeName.trim() || undefined,
        phone: form.phone,
        zipCode: form.zipCode,
        street: form.street.trim(),
        number: form.number.trim(),
        complement: form.complement.trim() || undefined,
        district: form.district.trim(),
        city: form.city.trim(),
        state: form.state,
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      };
      await register(payload);
      // Decisão de produto: depois do cadastro NÃO entra direto no sistema — volta pro site já
      // logado; a Navbar mostra "Entrar no sistema" (Task 9) e a LandingPage mostra "Conta criada!".
      navigate('/', { state: { registered: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível criar a conta.';
      if (isWeakPasswordError(message)) {
        setErrors({ password: message });
        return;
      }
      setError(message);
      // Documento duplicado é erro da etapa 1 — leva o usuário de volta pra lá.
      if (/CNPJ|CPF/.test(message)) setStep(0);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const isPJ = form.personType === 'PJ';

  return (
    <div
      className="relative min-h-screen bg-background overflow-hidden flex items-center justify-center transition-colors duration-300 py-12"
      onMouseMove={handleMouseMove}
    >
      <FlowBackground />

      <div className="relative z-10 w-full max-w-lg px-6 pointer-events-auto">
        <Link to="/" className="inline-flex items-center text-foreground/60 hover:text-foreground mb-8 transition-colors">
          <ArrowLeft size={16} className="mr-2" />
          Voltar para Home
        </Link>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
          className="glass-panel p-10 rounded-3xl"
        >
          <Mascot mousePosition={mousePos} isCoveringEyes={isCovering} />

          <div className="text-center mb-6 mt-8">
            <h1 className="text-3xl font-heading font-bold mb-2 text-foreground">QuickFlow</h1>
            <p className="text-foreground/60">Crie sua conta para começar.</p>

            {planName && (
              <div className="mt-4 bg-primary/10 border border-primary/20 text-primary text-sm font-medium py-2 px-4 rounded-lg inline-block">
                Plano selecionado: {planName}
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-2 mb-6">
            {STEP_TITLES.map((title, i) => (
              <React.Fragment key={title}>
                {i > 0 && <div className="h-px w-8 bg-border" />}
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      i <= step ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted'
                    }`}
                  >
                    {i < step ? <Check size={14} /> : i + 1}
                  </div>
                  <span className={`text-[11px] ${i === step ? 'text-foreground font-medium' : 'text-muted'}`}>{title}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
          <p className="text-center text-xs text-muted mb-6">Etapa {step + 1} de 3</p>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleRegister}>
            {step === 0 && (
              <>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => handlePersonTypeChange('PJ')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      isPJ ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-foreground/70'
                    }`}
                  >
                    Pessoa Jurídica
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePersonTypeChange('PF')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      !isPJ ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-foreground/70'
                    }`}
                  >
                    Pessoa Física
                  </button>
                </div>

                <FormField label={isPJ ? 'CNPJ' : 'CPF'} required error={errors.document}>
                  <div className="relative">
                    <input
                      type="text"
                      value={form.document}
                      onChange={(e) => set('document', isPJ ? formatCnpjInput(e.target.value) : formatCpfInput(e.target.value))}
                      onBlur={handleDocumentBlur}
                      className={`w-full bg-background border ${inputBorderClass(!!errors.document)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                      placeholder={isPJ ? '00.000.000/0000-00' : '000.000.000-00'}
                      onFocus={() => setIsCovering(false)}
                    />
                    {isLookingUp && isPJ && (
                      <Loader2 size={16} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
                    )}
                  </div>
                </FormField>

                <FormField label={isPJ ? 'Razão Social' : 'Nome Completo'} required error={errors.legalName}>
                  <input
                    type="text"
                    maxLength={NAME_MAX_LENGTH}
                    value={form.legalName}
                    onChange={(e) => set('legalName', e.target.value)}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.legalName)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder={isPJ ? 'Razão social da empresa' : 'Seu nome completo'}
                    onFocus={() => setIsCovering(false)}
                  />
                </FormField>

                <FormField label={`Nome Fantasia${!isPJ ? ' (opcional)' : ''}`} required={isPJ} error={errors.tradeName}>
                  <input
                    type="text"
                    maxLength={NAME_MAX_LENGTH}
                    value={form.tradeName}
                    onChange={(e) => set('tradeName', e.target.value)}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.tradeName)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder="Nome fantasia"
                    onFocus={() => setIsCovering(false)}
                  />
                </FormField>

                <FormField label="Telefone" required error={errors.phone}>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => set('phone', formatPhoneInput(e.target.value))}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.phone)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder="(00) 00000-0000"
                    onFocus={() => setIsCovering(false)}
                  />
                </FormField>
              </>
            )}

            {step === 1 && (
              <>
                <FormField label="CEP" required error={errors.zipCode}>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={form.zipCode}
                      onChange={(e) => set('zipCode', formatCepInput(e.target.value))}
                      onBlur={handleCepBlur}
                      className={`w-full bg-background border ${inputBorderClass(!!errors.zipCode)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                      placeholder="00000-000"
                      onFocus={() => setIsCovering(false)}
                    />
                    {isLookingUp && (
                      <Loader2 size={16} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
                    )}
                  </div>
                </FormField>

                <FormField label="Logradouro" required error={errors.street}>
                  <input
                    type="text"
                    maxLength={NAME_MAX_LENGTH}
                    value={form.street}
                    onChange={(e) => set('street', e.target.value)}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.street)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder="Rua, avenida..."
                    onFocus={() => setIsCovering(false)}
                  />
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Número" required error={errors.number}>
                    <input
                      type="text"
                      maxLength={20}
                      value={form.number}
                      onChange={(e) => set('number', e.target.value)}
                      className={`w-full bg-background border ${inputBorderClass(!!errors.number)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                      placeholder="123"
                      onFocus={() => setIsCovering(false)}
                    />
                  </FormField>
                  <FormField label="Complemento" error={errors.complement}>
                    <input
                      type="text"
                      maxLength={NAME_MAX_LENGTH}
                      value={form.complement}
                      onChange={(e) => set('complement', e.target.value)}
                      className={`w-full bg-background border ${inputBorderClass(!!errors.complement)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                      placeholder="Sala, bloco..."
                      onFocus={() => setIsCovering(false)}
                    />
                  </FormField>
                </div>

                <FormField label="Bairro" required error={errors.district}>
                  <input
                    type="text"
                    maxLength={NAME_MAX_LENGTH}
                    value={form.district}
                    onChange={(e) => set('district', e.target.value)}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.district)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder="Bairro"
                    onFocus={() => setIsCovering(false)}
                  />
                </FormField>

                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Cidade" required error={errors.city}>
                    <input
                      type="text"
                      maxLength={NAME_MAX_LENGTH}
                      value={form.city}
                      onChange={(e) => set('city', e.target.value)}
                      className={`w-full bg-background border ${inputBorderClass(!!errors.city)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                      placeholder="Cidade"
                      onFocus={() => setIsCovering(false)}
                    />
                  </FormField>
                  <FormField label="UF" required error={errors.state}>
                    <select
                      value={form.state}
                      onChange={(e) => set('state', e.target.value)}
                      onFocus={() => setIsCovering(false)}
                      className={`w-full bg-background border ${inputBorderClass(!!errors.state)} rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 transition-all`}
                    >
                      <option value="">Selecione</option>
                      {BRAZILIAN_STATES.map((uf) => (
                        <option key={uf} value={uf}>{uf}</option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <FormField label="Seu Nome" required error={errors.name}>
                  <input
                    type="text"
                    maxLength={NAME_MAX_LENGTH}
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.name)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder="Como devemos te chamar"
                    onFocus={() => setIsCovering(false)}
                  />
                </FormField>

                <FormField label="E-mail" required error={errors.email}>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.email)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder="nome@empresa.com"
                    onFocus={() => setIsCovering(false)}
                  />
                </FormField>

                <FormField label="Senha" required error={errors.password}>
                  <input
                    type="password"
                    minLength={8}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.password)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder="Crie uma senha forte"
                    autoComplete="new-password"
                    onFocus={() => setIsCovering(true)}
                    onBlurCapture={() => setIsCovering(false)}
                  />
                  <PasswordStrengthMeter strength={passwordStrength.strength} isChecking={passwordStrength.isChecking} />
                </FormField>

                <FormField label="Confirmar senha" required error={errors.confirmPassword}>
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(e) => set('confirmPassword', e.target.value)}
                    className={`w-full bg-background border ${inputBorderClass(!!errors.confirmPassword)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                    placeholder="Repita a senha"
                    autoComplete="new-password"
                    onFocus={() => setIsCovering(true)}
                    onBlurCapture={() => setIsCovering(false)}
                  />
                </FormField>
              </>
            )}

            <div className="flex items-center gap-3 mt-6">
              {step > 0 && (
                <button
                  type="button"
                  onClick={() => { setErrors({}); changeStep((step - 1) as Step); }}
                  className="flex-1 bg-secondary/50 hover:bg-secondary text-foreground font-medium py-3 rounded-xl transition-colors"
                >
                  Voltar
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {step < 2 ? 'Próximo' : isSubmitting ? 'Criando conta...' : 'Criar Conta'}
              </button>
            </div>

            {/* Aviso de busca (CNPJ/CEP) fica ABAIXO dos botões: aparecer/sumir aqui nunca desloca
                "Próximo"/"Voltar" no meio de um clique. */}
            {lookupNotice && (
              <div role="status" className="rounded-xl border border-border bg-secondary/30 text-sm text-foreground/70 p-3">
                {lookupNotice}
              </div>
            )}
          </form>

          <div className="mt-6 text-center text-sm text-foreground/60">
            Já tem uma conta? <Link to="/login" className="text-primary hover:underline">Faça login</Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Register;
