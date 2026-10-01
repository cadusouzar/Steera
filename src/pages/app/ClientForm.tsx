import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';
import PermissionDeniedNotice from '../../components/PermissionDeniedNotice';
import { Button, ButtonLink, Field, Input, Notice } from '../../components/ui';
import * as api from '../../lib/api';
import { useCan } from '../../lib/auth';
import { isValidEmail, NAME_MAX_LENGTH } from '../../lib/validation';

// Novo cliente (kit, etapa 5 do polimento — 01/10/2026). Mesmo cabeçalho do cadastro de funcionário.

const ClientForm = () => {
  const navigate = useNavigate();
  const can = useCan();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const [errors, setErrors] = useState<{ name?: string; contact?: string; email?: string }>({});

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSaving) return;

    const nextErrors: typeof errors = {};
    if (!name.trim()) nextErrors.name = 'Informe o nome';
    else if (name.length > NAME_MAX_LENGTH) nextErrors.name = `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres`;
    if (!contact.trim()) nextErrors.contact = 'Informe um telefone ou contato';
    if (email && !isValidEmail(email)) nextErrors.email = 'E-mail inválido';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveError('Corrija os campos destacados antes de salvar.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await api.createClient({
        name: name.trim(),
        category: category.trim() || undefined,
        contact: contact.trim(),
        email: email.trim() || undefined,
        customFields,
      });
      navigate('/app/clientes');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Não foi possível salvar o cliente.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!can('clientes.gerenciar')) {
    return <PermissionDeniedNotice message="Seu perfil não permite cadastrar clientes." backTo="/app/clientes" backLabel="Voltar para Clientes" />;
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/app/clientes" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground transition-colors">
          <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" /> Clientes
        </Link>
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[26px] md:text-[28px] font-semibold tracking-tight text-foreground leading-tight">Novo cliente</h1>
            <p className="mt-1 text-[14px] text-muted">Os campos com * são obrigatórios. Cobranças e assinaturas ficam na ficha, depois do cadastro.</p>
          </div>
          <div className="flex gap-2">
            <ButtonLink to="/app/clientes" variant="secondary">Cancelar</ButtonLink>
            <Button onClick={() => handleSave()} loading={isSaving}>Salvar cliente</Button>
          </div>
        </header>

        {saveError && <Notice tone="danger" className="mb-4">{saveError}</Notice>}

        <form onSubmit={handleSave} className="bg-panel border border-border rounded-lg shadow-sm p-5 md:p-6" noValidate>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome" htmlFor="c-name" required error={errors.name} className="md:col-span-2">
              <Input
                id="c-name" value={name} maxLength={NAME_MAX_LENGTH} invalid={!!errors.name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome da pessoa ou empresa"
              />
            </Field>
            <Field label="Categoria ou observação" htmlFor="c-category" hint="Ex.: turma, plano, segmento.">
              <Input id="c-category" value={category} onChange={(e) => setCategory(e.target.value)} />
            </Field>
            <Field label="Telefone ou contato" htmlFor="c-contact" required error={errors.contact}>
              <Input
                id="c-contact" value={contact} invalid={!!errors.contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="(00) 00000-0000"
              />
            </Field>
            <Field label="E-mail" htmlFor="c-email" error={errors.email} className="md:col-span-2">
              <Input
                id="c-email" type="email" value={email} invalid={!!errors.email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setErrors((prev) => ({ ...prev, email: email && !isValidEmail(email) ? 'E-mail inválido' : undefined }))}
                placeholder="email@exemplo.com"
              />
            </Field>
          </div>

          <CustomFieldsFormSection entity="client" values={customFields} onChange={setCustomFields} />
          {/* Enter dentro do formulário envia (o botão visível fica no cabeçalho). */}
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">Salvar</button>
        </form>
      </div>
    </div>
  );
};

export default ClientForm;
