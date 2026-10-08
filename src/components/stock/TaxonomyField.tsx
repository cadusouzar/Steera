import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Field, Input, Select, toast } from '../ui';
import { createTaxonomy, type TaxonomyItem, type TaxonomyKind } from '../../lib/stock';

interface Props {
  kind: TaxonomyKind;
  label: string;
  items: TaxonomyItem[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (item: TaxonomyItem) => void;
  canCreate: boolean;
}

// Categoria/marca: escolhe da lista da empresa ou cria uma nova ali mesmo, sem sair do formulário.
const TaxonomyField = ({ kind, label, items, value, onChange, onCreated, canCreate }: Props) => {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const id = `taxonomy-${kind}`;

  const save = async () => {
    if (!name.trim()) {
      setError('Informe o nome');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const created = await createTaxonomy(kind, name.trim());
      toast.success(`${kind === 'categories' ? 'Categoria criada' : 'Marca criada'}: ${created.name}`);
      onCreated(created);
      onChange(created.id);
      setAdding(false);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar.');
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <Field label={`Nova ${label.toLowerCase()}`} htmlFor={`${id}-new`} error={error}>
        <div className="flex gap-2">
          <Input
            id={`${id}-new`}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            invalid={!!error}
            autoFocus
          />
          <Button onClick={save} loading={saving}>Criar</Button>
          <Button variant="ghost" onClick={() => { setAdding(false); setError(undefined); }} disabled={saving}>Cancelar</Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id}>
      <div className="flex gap-2">
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="flex-1">
          <option value="">Sem {label.toLowerCase()}</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </Select>
        {canCreate && (
          <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)} aria-label={`Nova ${label.toLowerCase()}`}>
            <span className="hidden sm:inline">Nova</span>
          </Button>
        )}
      </div>
    </Field>
  );
};

export default TaxonomyField;
