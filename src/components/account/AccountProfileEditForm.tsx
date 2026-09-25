import React, { useRef, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import FormField from '../FormField';
import { fetchAddressByCep } from '../../lib/brazilLookups';
import { updateMyCompany, updateMyName, type CurrentUser } from '../../lib/auth';
import {
  BRAZILIAN_STATES,
  NAME_MAX_LENGTH,
  formatCepInput,
  formatPhoneInput,
  inputBorderClass,
  isValidPhone,
} from '../../lib/validation';

interface AccountProfileEditFormProps {
  user: CurrentUser;
  onCancel: () => void;
  onSaved: (user: CurrentUser) => void;
}

interface CompanyForm {
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
}

type Errors = Partial<Record<'name' | keyof CompanyForm, string>>;

const NUMBER_MAX_LENGTH = 20; // mesmo teto de UpdateCompanyDto.number no backend

function companyFormFrom(user: CurrentUser): CompanyForm {
  const a = user.companyAddress;
  return {
    legalName: user.legalName ?? '',
    tradeName: user.tradeName ?? '',
    phone: user.companyPhone ? formatPhoneInput(user.companyPhone) : '',
    zipCode: a?.zipCode ? formatCepInput(a.zipCode) : '',
    street: a?.street ?? '',
    number: a?.number ?? '',
    complement: a?.complement ?? '',
    district: a?.district ?? '',
    city: a?.city ?? '',
    state: a?.state ?? '',
  };
}

function required(value: string, label: string, max = NAME_MAX_LENGTH): string | undefined {
  if (!value.trim()) return `${label} é obrigatório`;
  if (value.trim().length > max) return `${label} deve ter no máximo ${max} caracteres`;
  return undefined;
}

// Formulário de edição da aba Perfil de "Minha conta" (site). Nome: qualquer login. Dados da
// empresa: só ADMIN (o backend recusa com 403 os demais) — CPF/CNPJ e tipo de pessoa nunca são
// editáveis. Mesmas regras de validação do cadastro; o backend valida tudo de novo.
const AccountProfileEditForm: React.FC<AccountProfileEditFormProps> = ({ user, onCancel, onSaved }) => {
  const isAdmin = user.role === 'admin';
  const isPF = user.personType === 'PF';
  const initialCompany = useRef(companyFormFrom(user));
  const [name, setName] = useState(user.name ?? '');
  const [company, setCompany] = useState<CompanyForm>(initialCompany.current);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [cepNotice, setCepNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const cepLookupSeq = useRef(0);
  const lastLookedUpCep = useRef(initialCompany.current.zipCode.replace(/\D/g, ''));

  const setField = (key: keyof CompanyForm, value: string) => {
    setCompany((c) => ({ ...c, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  // CEP novo → preenche logradouro/bairro/cidade/UF pelo ViaCEP (a pessoa acabou de trocar o CEP, então
  // substituir o endereço antigo é o esperado). Resposta atrasada de um CEP que já mudou é ignorada.
  const handleCepBlur = async () => {
    const digits = company.zipCode.replace(/\D/g, '');
    if (digits.length !== 8 || digits === lastLookedUpCep.current) return;
    lastLookedUpCep.current = digits;
    const seq = ++cepLookupSeq.current;
    setCepNotice(null);
    const address = await fetchAddressByCep(digits);
    if (seq !== cepLookupSeq.current) return;
    if (!address) {
      setCepNotice('Não encontramos este CEP, preencha o endereço manualmente.');
      return;
    }
    setCompany((c) =>
      c.zipCode.replace(/\D/g, '') !== digits
        ? c
        : { ...c, street: address.street || c.street, district: address.district || c.district, city: address.city || c.city, state: address.state || c.state },
    );
    setErrors((e) => ({ ...e, street: undefined, district: undefined, city: undefined, state: undefined }));
  };

  const validate = (): Errors => {
    const e: Errors = { name: required(name, 'Nome') };
    if (isAdmin) {
      e.legalName = required(company.legalName, isPF ? 'Nome completo' : 'Razão social');
      e.tradeName = isPF
        ? company.tradeName.trim().length > NAME_MAX_LENGTH ? `Nome fantasia deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined
        : required(company.tradeName, 'Nome fantasia');
      e.phone = !company.phone.trim() ? 'Telefone é obrigatório' : isValidPhone(company.phone) ? undefined : 'Telefone inválido';
      e.zipCode = company.zipCode.replace(/\D/g, '').length === 8 ? undefined : 'CEP deve ter 8 dígitos';
      e.street = required(company.street, 'Logradouro');
      e.number = required(company.number, 'Número', NUMBER_MAX_LENGTH);
      e.district = required(company.district, 'Bairro');
      e.city = required(company.city, 'Cidade');
      e.state = (BRAZILIAN_STATES as readonly string[]).includes(company.state) ? undefined : 'Selecione a UF';
    }
    return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Errors;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    setError(null);
    setIsSaving(true);
    try {
      let latest = user;
      if (name.trim() !== (user.name ?? '')) latest = await updateMyName(name.trim());
      const companyChanged = JSON.stringify(company) !== JSON.stringify(initialCompany.current);
      if (isAdmin && companyChanged) {
        latest = await updateMyCompany({
          legalName: company.legalName.trim(),
          tradeName: company.tradeName.trim() || undefined,
          phone: company.phone,
          zipCode: company.zipCode,
          street: company.street.trim(),
          number: company.number.trim(),
          complement: company.complement.trim() || undefined,
          district: company.district.trim(),
          city: company.city.trim(),
          state: company.state,
        });
      }
      onSaved(latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass = (hasError: boolean) =>
    `w-full bg-background border ${inputBorderClass(hasError)} rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-shadow disabled:bg-secondary/30 disabled:text-muted disabled:cursor-not-allowed`;

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-600 dark:text-red-400 text-sm">{error}</div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-lg font-bold text-foreground mb-2">Seus dados</legend>
        <FormField label="Seu nome" htmlFor="account-name" required error={errors.name}>
          <input
            id="account-name"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            onChange={(e) => { setName(e.target.value); setErrors((er) => ({ ...er, name: undefined })); }}
            className={inputClass(!!errors.name)}
          />
        </FormField>
        <p className="text-xs text-muted">E-mail ({user.email}) não pode ser alterado.</p>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-bold text-foreground mb-2">Dados da empresa</legend>
        {!isAdmin && (
          <p className="flex items-start gap-2 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm text-muted">
            <Lock size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            Os dados da empresa só podem ser alterados por um administrador — abaixo, apenas para consulta.
          </p>
        )}
        {/* `disabled` nativo do fieldset bloqueia todos os campos de uma vez pra quem não é ADMIN: os
            dados aparecem preenchidos (consulta), mas não dá pra editar — e o backend recusaria (403). */}
        <fieldset disabled={!isAdmin} className="space-y-4">
            <FormField label={isPF ? 'Nome completo' : 'Razão social'} htmlFor="account-legal-name" required={isAdmin} error={errors.legalName}>
              <input id="account-legal-name" value={company.legalName} maxLength={NAME_MAX_LENGTH} onChange={(e) => setField('legalName', e.target.value)} className={inputClass(!!errors.legalName)} />
            </FormField>
            <FormField label={isPF ? 'Nome fantasia (opcional)' : 'Nome fantasia'} htmlFor="account-trade-name" required={isAdmin && !isPF} error={errors.tradeName}>
              <input id="account-trade-name" value={company.tradeName} maxLength={NAME_MAX_LENGTH} onChange={(e) => setField('tradeName', e.target.value)} className={inputClass(!!errors.tradeName)} />
            </FormField>
            <FormField label="Telefone" htmlFor="account-phone" required={isAdmin} error={errors.phone}>
              <input id="account-phone" value={company.phone} inputMode="tel" onChange={(e) => setField('phone', formatPhoneInput(e.target.value))} placeholder="(00) 00000-0000" className={inputClass(!!errors.phone)} />
            </FormField>
            <FormField label="CEP" htmlFor="account-zip" required={isAdmin} error={errors.zipCode}>
              <input id="account-zip" value={company.zipCode} inputMode="numeric" onChange={(e) => setField('zipCode', formatCepInput(e.target.value))} onBlur={handleCepBlur} placeholder="00000-000" className={inputClass(!!errors.zipCode)} />
            </FormField>
            {cepNotice && <p className="text-sm text-foreground/70">{cepNotice}</p>}
            <FormField label="Logradouro" htmlFor="account-street" required={isAdmin} error={errors.street}>
              <input id="account-street" value={company.street} maxLength={NAME_MAX_LENGTH} onChange={(e) => setField('street', e.target.value)} className={inputClass(!!errors.street)} />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Número" htmlFor="account-number" required={isAdmin} error={errors.number}>
                <input id="account-number" value={company.number} maxLength={NUMBER_MAX_LENGTH} onChange={(e) => setField('number', e.target.value)} className={inputClass(!!errors.number)} />
              </FormField>
              <FormField label="Complemento" htmlFor="account-complement" error={errors.complement}>
                <input id="account-complement" value={company.complement} maxLength={NAME_MAX_LENGTH} onChange={(e) => setField('complement', e.target.value)} className={inputClass(!!errors.complement)} />
              </FormField>
            </div>
            <FormField label="Bairro" htmlFor="account-district" required={isAdmin} error={errors.district}>
              <input id="account-district" value={company.district} maxLength={NAME_MAX_LENGTH} onChange={(e) => setField('district', e.target.value)} className={inputClass(!!errors.district)} />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-4">
              <FormField label="Cidade" htmlFor="account-city" required={isAdmin} error={errors.city}>
                <input id="account-city" value={company.city} maxLength={NAME_MAX_LENGTH} onChange={(e) => setField('city', e.target.value)} className={inputClass(!!errors.city)} />
              </FormField>
              <FormField label="UF" htmlFor="account-state" required={isAdmin} error={errors.state}>
                <select id="account-state" value={company.state} onChange={(e) => setField('state', e.target.value)} className={inputClass(!!errors.state)}>
                  <option value="">Selecione</option>
                  {BRAZILIAN_STATES.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <p className="text-xs text-muted">
              {user.personType === 'PF' ? 'CPF' : 'CNPJ'} ({user.documentMasked ?? '—'}) e tipo de conta não podem ser alterados.
            </p>
        </fieldset>
      </fieldset>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="px-5 py-2.5 rounded-xl text-sm font-bold text-foreground border border-border hover:bg-secondary/50 transition-colors disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 inline-flex items-center justify-center gap-2"
        >
          {isSaving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          Salvar alterações
        </button>
      </div>
    </form>
  );
};

export default AccountProfileEditForm;
