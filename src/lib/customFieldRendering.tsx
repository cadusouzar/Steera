import { CustomFieldDefinition, CustomFieldType } from './api';

// Compartilhado entre CustomFieldsFormSection (preenche o valor de um campo num registro real) e
// CustomFieldsSettings (escolhe o valor padrão ao configurar o campo em si) — extraído pra um
// arquivo à parte (não-componente) porque misturar essas funções no mesmo arquivo do componente
// quebrava o Fast Refresh (`react-refresh/only-export-components`, bloqueado por `--max-warnings 0`).
export const TYPE_LABELS: Record<string, string> = {
  TEXT: 'Texto', LONG_TEXT: 'Texto', NUMBER: 'Número', CURRENCY: 'Valor em dinheiro',
  DATE: 'Data', DATETIME: 'Data e hora', BOOLEAN: 'Sim ou não', SELECT: 'Lista de opções',
  MULTI_SELECT: 'Lista de opções', EMAIL: 'E-mail', PHONE: 'Telefone',
};

// Só entra em jogo quando o campo nunca foi tocado (`value === undefined`) — reaproveita a MESMA
// leitura de `defaultValue` que o backend já aplica em `resolveValuesForCreate` (nunca escrita, só
// pré-preenchida na tela, pra quem estiver criando um registro ver o padrão configurado em vez de
// um campo vazio; se a pessoa não mexer, o campo continua ausente do payload e o backend aplica o
// mesmo default na escrita — ver `CustomFieldValuesService.parseDefaultValue`). `MULTI_SELECT` é
// guardado com JSON.parse defensivo: um `defaultValue` mal-formado nunca deve quebrar o formulário
// inteiro, só deixa aquele campo sem pré-preenchimento.
export function parseDefaultForDisplay(field: Pick<CustomFieldDefinition, 'type' | 'defaultValue'>): unknown {
  if (field.defaultValue === null || field.defaultValue === undefined || field.defaultValue === '') return undefined;
  switch (field.type) {
    case 'NUMBER':
    case 'CURRENCY':
      return Number(field.defaultValue);
    case 'BOOLEAN':
      return field.defaultValue === 'true';
    case 'MULTI_SELECT':
      try {
        return JSON.parse(field.defaultValue);
      } catch {
        return undefined;
      }
    default:
      return field.defaultValue;
  }
}

// Inverso de `parseDefaultForDisplay` — usado só ao configurar o campo (`CustomFieldsSettings.tsx`),
// pra guardar o valor escolhido no widget tipado (número, sim/não, opções) de volta como a string
// crua que `CustomFieldDefinition.defaultValue` sempre é no banco.
export function serializeDefaultValue(type: CustomFieldType, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  switch (type) {
    case 'BOOLEAN':
      return value ? 'true' : 'false';
    case 'MULTI_SELECT':
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

// Núcleo do renderizador — puro, sem noção de "valor padrão" nem de qual entidade/registro é dono
// do campo. Reaproveitado tanto pra exibir o valor real de um registro (`renderInput`, em
// CustomFieldsFormSection) quanto pra escolher o valor padrão em si na tela de configuração.
export function renderTypedInput(
  type: CustomFieldType,
  options: string[] | undefined,
  value: unknown,
  onChange: (v: unknown) => void,
) {
  const baseClass = 'w-full px-3 py-2 rounded-lg border border-border bg-panel text-foreground text-sm';

  switch (type) {
    case 'LONG_TEXT':
      return (
        <textarea className={baseClass} rows={3} value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)} />
      );
    case 'NUMBER':
    case 'CURRENCY':
      return (
        <input type="number" step="0.01" className={baseClass} value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      );
    case 'DATE':
      return (
        <input type="date" className={baseClass} value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)} />
      );
    case 'DATETIME':
      return (
        <input type="datetime-local" className={baseClass} value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)} />
      );
    case 'BOOLEAN':
      return (
        <input type="checkbox" className="w-5 h-5" checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)} />
      );
    case 'SELECT':
      return (
        <select className={baseClass} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Selecione...</option>
          {(options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case 'MULTI_SELECT': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-1.5 text-sm px-2 py-1 rounded-lg border border-border">
              <input type="checkbox" checked={selected.includes(opt)}
                onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((o) => o !== opt))} />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    case 'EMAIL':
      return <input type="email" className={baseClass} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'PHONE':
      return <input type="tel" className={baseClass} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input type="text" className={baseClass} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}
