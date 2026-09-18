import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CustomFieldsFormSection from '../../components/CustomFieldsFormSection';
import FormField from '../../components/FormField';
import * as api from '../../lib/api';
import { inputBorderClass, isValidEmail, NAME_MAX_LENGTH } from '../../lib/validation';

const ClientForm = () => {
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});

  const [nameError, setNameError] = useState<string>();
  const [emailError, setEmailError] = useState<string>();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const missingFields: string[] = [];
    if (!name.trim()) missingFields.push('Nome Completo');
    if (!contact.trim()) missingFields.push('Telefone/Contato');
    if (missingFields.length > 0) {
      setSaveError(`Preencha os campos obrigatórios: ${missingFields.join(', ')}.`);
      return;
    }

    const nameErr = name.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined;
    const emailErr = email && !isValidEmail(email) ? 'E-mail inválido' : undefined;
    setNameError(nameErr);
    setEmailError(emailErr);
    if (nameErr || emailErr) {
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
              to="/app/clientes"
              className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">Novo Cliente</h1>
              <p className="text-muted text-sm mt-1">Preencha os dados do cliente.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/app/clientes')}
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
              {isSaving ? 'Salvando...' : 'Cadastrar Cliente'}
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
                <FormField label="Nome Completo" required error={nameError}>
                  <input
                    type="text" value={name} maxLength={NAME_MAX_LENGTH}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setNameError(name.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined)}
                    className={`w-full bg-background border ${inputBorderClass(!!nameError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                    placeholder="Ex: Ana Laura / Rex"
                  />
                </FormField>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Categoria / Observação</label>
                <input
                  type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50"
                  placeholder="Ex: Turma A / Pastor Alemão"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-2">Telefone/Contato</label>
                <input
                  type="text" value={contact} onChange={(e) => setContact(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50"
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div className="md:col-span-2">
                <FormField label="E-mail (Opcional)" error={emailError}>
                  <input
                    type="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setEmailError(email && !isValidEmail(email) ? 'E-mail inválido' : undefined)}
                    className={`w-full bg-background border ${inputBorderClass(!!emailError)} rounded-xl px-4 py-3 focus:ring-2 transition-colors`}
                    placeholder="email@exemplo.com"
                  />
                </FormField>
              </div>
            </div>

            <CustomFieldsFormSection entity="client" values={customFields} onChange={setCustomFields} />
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export default ClientForm;
