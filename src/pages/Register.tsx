import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import Mascot from '../components/Mascot';
import { Field, SegmentedControl } from '../components/ui';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import { usePasswordStrength } from '../hooks/usePasswordStrength';
import { buildPasswordUserInputs, isWeakPasswordError } from '../lib/passwordStrength';
import { register, type RegisterPayload } from '../lib/auth';
import { fetchAddressByCep, fetchCnpjData } from '../lib/brazilLookups';
import SteeraLogo from '../components/brand/SteeraLogo';
import { BRAND_NAME } from '../lib/brand';
import {
  BRAZILIAN_STATES,
  formatCepInput,
  formatCnpjInput,
  formatCpfInput,
  formatPhoneInput,
  isValidCnpj,
  isValidCpf,
  isValidEmail,
  isValidPhone,
  NAME_MAX_LENGTH,
  stripCnpj,
} from '../lib/validation';

// Cadastro no modelo do login (02/10/2026): mesma base (fundo pontilhado, logo Steera, sempre claro) e
// um cartão largo em dois lados — o Stee, o título e as etapas à esquerda; os campos da etapa em duas
// colunas à direita — para as três etapas caberem sem rolar a partir de 1366×768.

const inputClass = (invalid: boolean) =>
  `w-full h-11 rounded-[8px] border bg-white px-3.5 text-[15px] text-[#111] placeholder:text-[#9a9a9a] outline-none transition-[border-color,box-shadow] duration-150 ${
    invalid ? 'border-danger focus:shadow-[0_0_0_3px_rgba(192,38,45,0.12)]' : 'border-[#e1e1e1] focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(17,17,17,0.08)]'
  }`;

const linkClass = 'rounded outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#111]';

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
  const [focusedPassword, setFocusedPassword] = useState(false);
  // Balão "Achei! Já preenchi pra você." depois de um autopreenchimento por CNPJ/CEP.
  const [justFilled, setJustFilled] = useState(false);

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
    setJustFilled(false);
    setForm((f) => ({ ...f, [key]: value }));
    clearFieldErrors([key]);
  };

  // Troca de etapa (nos dois sentidos) limpa avisos de busca e o banner de erro da etapa anterior:
  // um aviso de outra etapa sumindo depois (no blur do CEP, por exemplo) empurrava os botões entre
  // o mousedown e o click, e o primeiro "Próximo" se perdia.
  const changeStep = (next: Step) => {
    setLookupNotice(null);
    setJustFilled(false);
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
    if (keys.some((k) => patch[k])) setJustFilled(true);
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

  const isPJ = form.personType === 'PJ';

  const isCoveringEyes = focusedPassword && !isSubmitting;
  const bubble = isSubmitting ? 'Preparando tudo…'
    : error ? 'Opa, algo não bateu. Dá uma olhada?'
    : isCoveringEyes ? 'Pode digitar, não estou olhando!'
    : justFilled ? 'Achei! Já preenchi pra você.'
    : step === 0 ? 'Vamos começar pela sua empresa.'
    : step === 1 ? 'Onde fica a empresa?'
    : 'Agora é o seu acesso.';

  const field = (key: keyof FormState) => ({
    id: `reg-${key}`,
    'aria-invalid': errors[key] ? true : undefined,
    className: inputClass(!!errors[key]),
    onFocus: () => setFocusedPassword(false),
  });

  return (
    <div
      className="theme-light min-h-screen flex flex-col overflow-x-hidden bg-[#f4f4f3] bg-[radial-gradient(#dcdcda_1px,transparent_1px)] bg-[length:22px_22px] px-4 py-6 sm:px-10 font-sans text-[#111]"
      onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
    >
      <header className="flex items-center justify-between gap-4">
        <Link to="/" aria-label={`${BRAND_NAME} — página inicial`} className={linkClass}>
          <SteeraLogo size="text-[26px]" className="text-[#111]" />
        </Link>
        <Link to="/" className={`${linkClass} inline-flex items-center gap-1.5 text-[13px] font-medium text-[#666] hover:text-[#111]`}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
          Voltar para o site
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center py-5">
        <div className="w-full max-w-[920px] overflow-hidden rounded-[16px] border border-[#e4e4e2] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.06)] md:grid md:min-h-[540px] md:grid-cols-[300px_1fr]">
          {/* Lado do Stee: título, plano, etapas e o mascote com o balão. */}
          <aside className="relative flex flex-col border-b border-[#EFE4D2] bg-[#FDF8F0] bg-[radial-gradient(ellipse_70%_14%_at_50%_100%,rgba(62,39,34,0.07),transparent_70%)] px-6 pt-6 md:border-b-0 md:border-r">
            <h1 className="font-brand text-[24px] font-semibold leading-tight tracking-[-0.03em] text-[#3E2722]">Criar conta grátis</h1>
            <p className="mt-1 text-[13px] text-[#6b5a55]">Leva uns 2 minutos.</p>
            {planName && (
              <p className="mt-3 w-fit rounded-full bg-white px-3 py-1 text-[12px] font-medium text-[#3E2722] shadow-[0_1px_3px_rgba(62,39,34,0.12)]">
                Plano escolhido: {planName}
              </p>
            )}

            <ol className="mt-5 flex gap-4 md:flex-col md:gap-2.5" aria-label="Etapas do cadastro">
              {STEP_TITLES.map((title, i) => {
                const done = i < step;
                const current = i === step;
                return (
                  <li key={title} aria-current={current ? 'step' : undefined} className="flex items-center gap-2.5">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors ${
                        current ? 'bg-[#111] text-white' : done ? 'bg-brand text-white' : 'border border-[#e2d6c3] bg-white text-[#8a7a72]'
                      }`}
                    >
                      {done ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : i + 1}
                    </span>
                    <span className={`text-[13px] ${current ? 'font-semibold text-[#111]' : 'text-[#6b5a55]'} ${current ? '' : 'hidden md:inline'}`}>
                      {title}
                      {done && <span className="sr-only"> (concluída)</span>}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="relative mt-auto flex justify-center pt-6 md:pt-3">
              <div className="[&>div]:mb-0 [&>div]:h-[150px] [&>div]:w-[170px] md:[&>div]:h-[200px] md:[&>div]:w-[230px]">
                <Mascot mousePosition={mousePos} isCoveringEyes={isCoveringEyes} />
              </div>
              <p
                aria-hidden="true"
                className="absolute right-0 top-0 max-w-[140px] rounded-[14px] rounded-bl-[4px] bg-white px-3 py-[9px] font-brand text-[13px] font-semibold leading-[1.3] text-[#3E2722] shadow-[0_4px_14px_rgba(62,39,34,0.1)] md:-right-1"
              >
                {bubble}
              </p>
            </div>
          </aside>

          {/* Lado do formulário: a etapa atual em duas colunas. */}
          <form onSubmit={handleRegister} noValidate className="flex flex-col gap-5 px-6 py-7 sm:px-9">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[18px] font-semibold tracking-tight">{STEP_TITLES[step]}</h2>
              <span className="text-[12px] text-[#666]">Etapa {step + 1} de 3</span>
            </div>

            {error && (
              <div role="alert" className="rounded-[8px] bg-[#FBEDE8] px-3.5 py-[11px] text-[13px] font-medium leading-[1.4] text-[#8A3220]">{error}</div>
            )}

            {step === 0 && (
              <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                <SegmentedControl<PersonType>
                  label="Tipo de cadastro"
                  value={form.personType}
                  onChange={handlePersonTypeChange}
                  options={[{ value: 'PJ', label: 'Pessoa jurídica' }, { value: 'PF', label: 'Pessoa física' }]}
                  className="sm:col-span-2 w-fit"
                />
                <Field label={isPJ ? 'CNPJ' : 'CPF'} htmlFor="reg-document" required error={errors.document}>
                  <div className="relative">
                    <input
                      {...field('document')}
                      inputMode={isPJ ? 'text' : 'numeric'}
                      value={form.document}
                      onChange={(e) => set('document', isPJ ? formatCnpjInput(e.target.value) : formatCpfInput(e.target.value))}
                      onBlur={handleDocumentBlur}
                      placeholder={isPJ ? '00.000.000/0000-00' : '000.000.000-00'}
                    />
                    {isLookingUp && isPJ && (
                      <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#777]" aria-label="Buscando dados do CNPJ" />
                    )}
                  </div>
                </Field>
                <Field label="Telefone" htmlFor="reg-phone" required error={errors.phone}>
                  <input {...field('phone')} type="tel" value={form.phone} onChange={(e) => set('phone', formatPhoneInput(e.target.value))} placeholder="(00) 00000-0000" />
                </Field>
                <Field label={isPJ ? 'Razão social' : 'Nome completo'} htmlFor="reg-legalName" required error={errors.legalName} className="sm:col-span-2">
                  <input {...field('legalName')} maxLength={NAME_MAX_LENGTH} value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder={isPJ ? 'Razão social da empresa' : 'Seu nome completo'} />
                </Field>
                <Field label={isPJ ? 'Nome fantasia' : 'Nome fantasia (opcional)'} htmlFor="reg-tradeName" required={isPJ} error={errors.tradeName} className="sm:col-span-2">
                  <input {...field('tradeName')} maxLength={NAME_MAX_LENGTH} value={form.tradeName} onChange={(e) => set('tradeName', e.target.value)} placeholder="Como a empresa é conhecida" />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-[1fr_1fr_120px]">
                <Field label="CEP" htmlFor="reg-zipCode" required error={errors.zipCode}>
                  <div className="relative">
                    <input {...field('zipCode')} inputMode="numeric" value={form.zipCode} onChange={(e) => set('zipCode', formatCepInput(e.target.value))} onBlur={handleCepBlur} placeholder="00000-000" />
                    {isLookingUp && (
                      <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#777]" aria-label="Buscando endereço" />
                    )}
                  </div>
                </Field>
                <Field label="Número" htmlFor="reg-number" required error={errors.number}>
                  <input {...field('number')} maxLength={20} value={form.number} onChange={(e) => set('number', e.target.value)} placeholder="123" />
                </Field>
                <Field label="UF" htmlFor="reg-state" required error={errors.state} className="col-span-2 sm:col-span-1">
                  <select {...field('state')} value={form.state} onChange={(e) => set('state', e.target.value)}>
                    <option value="">Selecione</option>
                    {BRAZILIAN_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                  </select>
                </Field>
                <Field label="Logradouro" htmlFor="reg-street" required error={errors.street} className="col-span-2 sm:col-span-3">
                  <input {...field('street')} maxLength={NAME_MAX_LENGTH} value={form.street} onChange={(e) => set('street', e.target.value)} placeholder="Rua, avenida…" />
                </Field>
                <Field label="Bairro" htmlFor="reg-district" required error={errors.district} className="col-span-2 sm:col-span-1">
                  <input {...field('district')} maxLength={NAME_MAX_LENGTH} value={form.district} onChange={(e) => set('district', e.target.value)} placeholder="Bairro" />
                </Field>
                <Field label="Cidade" htmlFor="reg-city" required error={errors.city} className="col-span-2 sm:col-span-1">
                  <input {...field('city')} maxLength={NAME_MAX_LENGTH} value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Cidade" />
                </Field>
                <Field label="Complemento" htmlFor="reg-complement" error={errors.complement} className="col-span-2 sm:col-span-1">
                  <input {...field('complement')} maxLength={NAME_MAX_LENGTH} value={form.complement} onChange={(e) => set('complement', e.target.value)} placeholder="Sala, bloco…" />
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                <Field label="Seu nome" htmlFor="reg-name" required error={errors.name}>
                  <input {...field('name')} maxLength={NAME_MAX_LENGTH} autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Como devemos te chamar" />
                </Field>
                <Field label="E-mail" htmlFor="reg-email" required error={errors.email}>
                  <input {...field('email')} type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="voce@empresa.com.br" />
                </Field>
                <Field label="Senha" htmlFor="reg-password" required error={errors.password}>
                  <input
                    {...field('password')}
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    onFocus={() => setFocusedPassword(true)}
                    onBlur={() => setFocusedPassword(false)}
                    placeholder="Crie uma senha forte"
                  />
                </Field>
                <Field label="Confirmar senha" htmlFor="reg-confirmPassword" required error={errors.confirmPassword}>
                  <input
                    {...field('confirmPassword')}
                    type="password"
                    autoComplete="new-password"
                    value={form.confirmPassword}
                    onChange={(e) => set('confirmPassword', e.target.value)}
                    onFocus={() => setFocusedPassword(true)}
                    onBlur={() => setFocusedPassword(false)}
                    placeholder="Repita a senha"
                  />
                </Field>
                <div className="sm:col-span-2 -mt-1">
                  <PasswordStrengthMeter strength={passwordStrength.strength} isChecking={passwordStrength.isChecking} />
                </div>
              </div>
            )}

            <div className="mt-auto flex flex-col gap-4 pt-1">
              <div className="flex items-center gap-3">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => { setErrors({}); changeStep((step - 1) as Step); }}
                    className="h-12 rounded-[8px] border border-[#e1e1e1] bg-white px-5 text-[15px] font-medium text-[#111] outline-none transition-colors hover:bg-[#f4f4f4] focus-visible:ring-2 focus-visible:ring-[#111]"
                  >
                    Voltar
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  aria-busy={isSubmitting || undefined}
                  className="h-12 flex-1 rounded-[8px] bg-[#111] text-[15px] font-semibold text-white outline-none transition-colors hover:bg-[#2a2a2a] active:bg-black focus-visible:ring-2 focus-visible:ring-[#111] focus-visible:ring-offset-2 disabled:opacity-70"
                >
                  {step < 2 ? 'Próximo' : isSubmitting ? 'Criando conta…' : 'Criar conta'}
                </button>
              </div>

              {/* Aviso de busca (CNPJ/CEP) fica ABAIXO dos botões: aparecer/sumir aqui nunca desloca
                  "Próximo"/"Voltar" no meio de um clique. */}
              {lookupNotice && (
                <p role="status" className="rounded-[8px] bg-[#F4F4F3] px-3.5 py-2.5 text-[13px] text-[#444]">{lookupNotice}</p>
              )}

              <p className="text-center text-[14px] text-[#666]">
                Já tem conta?{' '}
                <Link to="/login" className={`${linkClass} font-semibold text-[#111] hover:text-brand`}>Entrar</Link>
              </p>
            </div>
          </form>
        </div>
      </main>

      <footer className="text-[12px] text-[#666]">© 2026 {BRAND_NAME}</footer>
    </div>
  );
};

export default Register;
