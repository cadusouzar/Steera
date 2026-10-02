import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';
import PermissionDeniedNotice from '../../components/PermissionDeniedNotice';
import RoleColorPicker from '../../components/RoleColorPicker';
import { Button, ButtonLink, Field, Input, Notice, Textarea } from '../../components/ui';
import * as api from '../../lib/api';
import { useCan } from '../../lib/auth';
import { NAME_MAX_LENGTH, TEXT_MAX_LENGTH } from '../../lib/validation';
import { isValidRoleColor, validateRoleFields, type RoleFieldErrors } from '../../lib/roleFields';

// Novo cargo (kit, etapa 8 do polimento — 02/10/2026). Mesmo cabeçalho do cadastro de funcionário.

const RoleForm = () => {
  const navigate = useNavigate();
  const can = useCan();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [colorHex, setColorHex] = useState('#2563EB');
  const [description, setDescription] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<RoleFieldErrors>({});

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSaving) return;
    const nextErrors = validateRoleFields({ name, department, description });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !isValidRoleColor(colorHex)) {
      setSaveError('Corrija os campos destacados antes de salvar.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await api.createRole({
        name: name.trim(),
        department: department.trim(),
        colorHex: colorHex.toUpperCase(),
        description: description.trim() || undefined,
        customFields,
      });
      navigate('/app/cargos');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Não foi possível salvar o cargo.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!can('cargos.gerenciar')) {
    return <PermissionDeniedNotice message="Seu perfil não permite cadastrar cargos." backTo="/app/cargos" backLabel="Voltar para Cargos" />;
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/app/cargos" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground transition-colors">
          <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" /> Cargos
        </Link>
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[26px] md:text-[28px] font-semibold tracking-tight text-foreground leading-tight">Novo cargo</h1>
            <p className="mt-1 text-[14px] text-muted">Os campos com * são obrigatórios. Os cargos aparecem no cadastro de funcionários.</p>
          </div>
          <div className="flex gap-2">
            <ButtonLink to="/app/cargos" variant="secondary">Cancelar</ButtonLink>
            <Button onClick={() => handleSave()} loading={isSaving}>Salvar cargo</Button>
          </div>
        </header>

        {saveError && <Notice tone="danger" className="mb-4">{saveError}</Notice>}

        <form onSubmit={handleSave} className="bg-panel border border-border rounded-lg shadow-sm p-5 md:p-6 space-y-5" noValidate>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nome do cargo" htmlFor="r-name" required error={errors.name}>
              <Input id="r-name" value={name} maxLength={NAME_MAX_LENGTH} invalid={!!errors.name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Diretor de arte" data-autofocus />
            </Field>
            <Field label="Departamento" htmlFor="r-department" required error={errors.department}>
              <Input id="r-department" value={department} maxLength={NAME_MAX_LENGTH} invalid={!!errors.department} onChange={(e) => setDepartment(e.target.value)} placeholder="Ex.: Criação" />
            </Field>
          </div>
          <RoleColorPicker value={colorHex} onChange={setColorHex} />
          <Field label="Atribuições" htmlFor="r-description" error={errors.description} hint="O que esta pessoa faz no dia a dia.">
            <Textarea id="r-description" rows={4} value={description} maxLength={TEXT_MAX_LENGTH} invalid={!!errors.description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          <CustomFieldsFormSection entity="role" values={customFields} onChange={setCustomFields} />
          {/* Enter dentro do formulário envia (o botão visível fica no cabeçalho). */}
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">Salvar</button>
        </form>
      </div>
    </div>
  );
};

export default RoleForm;
