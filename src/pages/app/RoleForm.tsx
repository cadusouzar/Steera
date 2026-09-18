import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, Loader2, Check } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';
import FormField from '../../components/FormField';
import * as api from '../../lib/api';
import { inputBorderClass, NAME_MAX_LENGTH, TEXT_MAX_LENGTH } from '../../lib/validation';

const COLOR_SWATCHES = [
  '#3B82F6', '#A855F7', '#EC4899', '#EF4444',
  '#F97316', '#EAB308', '#22C55E', '#14B8A6', '#2563EB',
];

const RoleForm = () => {
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [colorHex, setColorHex] = useState('#2563EB');
  const [description, setDescription] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const [nameError, setNameError] = useState<string>();
  const [departmentError, setDepartmentError] = useState<string>();
  const [descriptionError, setDescriptionError] = useState<string>();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const missingFields: string[] = [];
    if (!name.trim()) missingFields.push('Nome do Cargo');
    if (!department.trim()) missingFields.push('Departamento');
    if (missingFields.length > 0) {
      setSaveError(`Preencha os campos obrigatórios: ${missingFields.join(', ')}.`);
      return;
    }

    const nameErr = name.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined;
    const departmentErr = department.length > NAME_MAX_LENGTH ? `Departamento deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined;
    const descriptionErr = description.length > TEXT_MAX_LENGTH ? `Descrição deve ter no máximo ${TEXT_MAX_LENGTH} caracteres` : undefined;
    setNameError(nameErr);
    setDepartmentError(departmentErr);
    setDescriptionError(descriptionErr);
    if (nameErr || departmentErr || descriptionErr) {
      setSaveError('Corrija os campos destacados antes de salvar.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      await api.createRole({
        name: name.trim(),
        department: department.trim(),
        colorHex,
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
              to="/app/cargos"
              className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">Novo Cargo</h1>
              <p className="text-muted text-sm mt-1">Preencha os dados do cargo.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/app/cargos')}
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
              {isSaving ? 'Salvando...' : 'Salvar Cargo'}
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {saveError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
            {saveError}
          </div>
        )}

        {/* Content */}
        <div className="glass-panel rounded-[2rem] border border-border/50">
          <form className="p-6 md:p-8 space-y-6" onSubmit={handleSave}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <FormField label="Nome do Cargo" required error={nameError}>
                  <input
                    type="text" autoFocus value={name} maxLength={NAME_MAX_LENGTH}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setNameError(name.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined)}
                    className={`w-full bg-background border ${inputBorderClass(!!nameError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                    placeholder="Ex: Diretor de Arte"
                  />
                </FormField>
              </div>
              <div className="md:col-span-2">
                <FormField label="Departamento" required error={departmentError}>
                  <input
                    type="text" value={department} maxLength={NAME_MAX_LENGTH}
                    onChange={(e) => setDepartment(e.target.value)}
                    onBlur={() => setDepartmentError(department.length > NAME_MAX_LENGTH ? `Departamento deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined)}
                    className={`w-full bg-background border ${inputBorderClass(!!departmentError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                    placeholder="Ex: Criação"
                  />
                </FormField>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground/80 mb-2">Cor de Identificação</label>
                <div className="flex flex-wrap gap-3 mb-3">
                  {COLOR_SWATCHES.map(hex => (
                    <button
                      key={hex} type="button"
                      onClick={() => setColorHex(hex)}
                      style={{ backgroundColor: hex }}
                      className={`w-9 h-9 rounded-full transition-transform flex items-center justify-center ${colorHex === hex ? 'ring-4 ring-primary/30 scale-110' : 'hover:scale-105 opacity-90'}`}
                    >
                      {colorHex === hex && <Check size={14} className="text-white" />}
                    </button>
                  ))}
                </div>
                <input
                  type="text" value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  pattern="^#[0-9A-Fa-f]{6}$" placeholder="#2563EB"
                  className="w-32 bg-background border border-border rounded-xl px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="md:col-span-2">
                <FormField label="Descrição (opcional)" error={descriptionError}>
                  <textarea
                    rows={3} value={description} maxLength={TEXT_MAX_LENGTH}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => setDescriptionError(description.length > TEXT_MAX_LENGTH ? `Descrição deve ter no máximo ${TEXT_MAX_LENGTH} caracteres` : undefined)}
                    className={`w-full bg-background border ${inputBorderClass(!!descriptionError)} rounded-xl p-3 text-sm text-foreground focus:outline-none focus:ring-2 resize-none transition-colors`}
                    placeholder="Atribuições e responsabilidades..."
                  />
                </FormField>
              </div>
            </div>

            <CustomFieldsFormSection entity="role" values={customFields} onChange={setCustomFields} />
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export default RoleForm;
